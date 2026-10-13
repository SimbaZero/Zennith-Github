// Server-only: giving a receptionist-registered patient a login of their own.
// Called through the server functions in src/lib/patient-invite.ts.
//
// Registration at the desk creates the patient's record but no sign-in
// account. Reception can then send a one-time "set your password" link by
// text, e-mail, or both. Following it creates the account and links it to the
// patient record, the same way self-signup does (a Firebase Auth user plus a
// `profiles/{uid}` document carrying the patientId).
//
// Two different mechanisms, by channel:
//
//   * E-mail (for a patient whose record has a real e-mail address): the
//     sign-in account is created up front, linked to the patient, and Firebase
//     Auth's own password-reset e-mail is sent to it. Firebase delivers it from
//     its own sender, so no mail domain needs verifying. (The shared default
//     sender does tend to land in spam; that comes with it.)
//   * Text message (and a patient with no e-mail at all): our own one-time
//     link, below. Firebase has no SMS equivalent, and its reset link is far too
//     long for a text. Following the link creates the account - or, if the
//     e-mail path already did, sets its password.
//
// The one case the e-mail channel keeps our own link for is "sign in with the
// Patient ID instead": that account has no real e-mail address, so Firebase
// has nowhere to send a reset (and sending it to the contact address would
// reset a DIFFERENT account that owns that address).
//
// Who may do what:
//   * sending needs a verified Firebase ID token whose profile is reception
//     (or an admin) at the patient's clinic;
//   * the phone number and e-mail come from the patient's record, never from
//     the request, so this can't be used to text an arbitrary number;
//   * the link holds a random 128-bit token. Only its SHA-256 is stored, it
//     works once, and it expires; sending a new one cancels the old.
//
// State lives in collections firestore.rules deny to every client:
//   patientInvites/{sha256(token)}   one issued link
//   patientInviteLimits/{patientId}  when the last link went, how many today,
//                                    and which link is current
import type {
  CompleteInviteResult,
  InviteChannelOutcome,
  InvitePreview,
  SendInviteResult,
} from "../lib/patient-invite";
import {
  looksLikeEmail,
  normaliseIdentifier,
  TEST_DOMAIN,
} from "../lib/login-identifier";
import { canonicalPatientId } from "../lib/patient-id";
import { sameClinicId } from "../lib/clinic-id";
import {
  isSmsConfigured,
  isSmsTestMode,
  sendSms,
  toSouthAfricanMobile,
  withoutPhoneNumbers,
} from "../lib/smsportal";
import { readEnv } from "./env";
import { verifyIdToken } from "./firebase-auth";
import { deleteLeftoverLogin } from "./login-admin";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  WriteConflict,
  type FirestoreAdmin,
} from "./firestore-admin";

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_SENDS_PER_DAY = 5;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
// Same minimum the sign-up form and set-password page enforce
// (MIN_INVITE_PASSWORD_LENGTH in src/lib/patient-invite.ts). Not imported:
// that file holds the server functions that load this one.
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const SIGN_UP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const DELETE_URL = "https://identitytoolkit.googleapis.com/v1/accounts:delete";

const SEND_OOB_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";

type Fs = Pick<
  FirestoreAdmin,
  "get" | "query" | "write" | "commit" | "projectId" | "identity"
>;

/* ---------------- helpers ---------------- */

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The address links point at. APP_URL when it's a real https address (so the
 * link never depends on a header the caller can influence), otherwise the
 * origin the request itself came to.
 */
export function linkOrigin(env: unknown, requestUrl?: string): string | null {
  const configured = readEnv(env, "APP_URL")?.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^/\s]+$/i.test(configured)) return configured;
  try {
    return requestUrl ? new URL(requestUrl).origin : null;
  } catch {
    return null;
  }
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || "there";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** What this patient signs in with: their real e-mail, else their Patient ID. */
export function loginFor(patientId: string, contactEmail: string) {
  const email = normaliseIdentifier(contactEmail);
  if (looksLikeEmail(email))
    return { username: email, authEmail: email, real: true };
  const username = patientId.toLowerCase();
  // Same synthetic form the seeded accounts use, which the sign-in box already
  // resolves from a username (see login-identifier.ts).
  return { username, authEmail: `${username}@${TEST_DOMAIN}`, real: false };
}

function smsText(name: string, link: string, username: string): string {
  return (
    `Zennith Health: ${firstName(name)}, your patient account is ready. ` +
    `Set your password: ${link} ` +
    `Then sign in with: ${username}. Link valid for 7 days.`
  );
}

function emailHtml(name: string, link: string, username: string): string {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
        <tr><td style="background:#1b2440;padding:24px 32px;text-align:center">
          <div style="color:#ffffff;font-size:22px;font-weight:700">Zennith Health Services</div>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 12px;font-size:20px">Hello ${escapeHtml(firstName(name))},</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151">
            The clinic has set up your Zennith patient account. Choose a password to finish.
          </p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">
            Your username to sign in with: <strong style="font-family:monospace">${escapeHtml(username)}</strong>
          </p>
          <a href="${safeLink}" style="display:inline-block;background:#1b2440;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">Set my password</a>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all">
            Or open this address: ${safeLink}<br>The link works once and is valid for 7 days.
          </p>
          <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
            If you weren't expecting this, you can ignore this message.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/* ---------------- sending ---------------- */

async function deliverSms(
  phone: string,
  message: string,
  env: unknown,
): Promise<InviteChannelOutcome> {
  const to = toSouthAfricanMobile(phone);
  if (!phone.trim()) return { status: "failed", reason: "no-phone" };
  if (!to) return { status: "failed", reason: "not-a-mobile" };

  // Text messaging is live only when SMSPortal is configured and test mode is
  // off. Otherwise the attempt is recorded (sendSms logs it, masked, without
  // the secret link) and the receptionist is told it's test mode - not that
  // something failed.
  const live = isSmsConfigured(env) && !isSmsTestMode(env);
  // The message holds the secret link, so it is never written to the log.
  const result = await sendSms({
    to,
    message,
    sensitive: true,
    testMode: live ? undefined : true,
    env,
  });
  // SMS_ONLY_TO (the "only text these test numbers" guard) is a test safeguard.
  if (result.reason === "not-on-sms-only-to") {
    return { status: "sent", mode: "test" };
  }
  if (!result.ok) {
    // Deliberately not shown to the receptionist - the screen says the same
    // thing whether or not it arrives - but never silent: it's in the log.
    console.error(
      "[patient-invite] SMS was not delivered:",
      withoutPhoneNumbers(result.reason ?? "unknown"),
    );
  }
  return { status: "sent", mode: live && !result.dryRun ? "live" : "test" };
}

/** a***@example.com: enough to recognise the address in a log, not to copy it. */
function maskedEmail(address: string): string {
  const [local, domain] = address.split("@");
  return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
}

async function deliverEmail(
  to: string,
  name: string,
  link: string,
  username: string,
  env: unknown,
): Promise<InviteChannelOutcome> {
  if (!looksLikeEmail(to)) return { status: "failed", reason: "no-email" };

  // Email works like text messaging: until it is turned on for real recipients,
  // an attempt is recorded and reported as test mode - not as a failure.
  //
  // TODO: verify sending domain before production. Real sending needs a Resend
  // account with a verified domain, RESEND_FROM set to an address on it, and
  // RESEND_API_KEY set. Until then the only sender available is Resend's shared
  // sandbox address, which delivers nowhere but the account owner's own inbox.
  const key = readEnv(env, "RESEND_API_KEY");
  const configuredFrom = readEnv(env, "RESEND_FROM")?.trim();
  const sandboxSender =
    !configuredFrom || /@resend\.dev\b/i.test(configuredFrom);
  const forcedTest = readEnv(env, "EMAIL_TEST_MODE") === "true";
  // The link is a secret, so it is never written to the log.
  const record = (why: string) =>
    console.info(
      `[email:test] invite for ${maskedEmail(to)} not sent (${why}); link not logged`,
    );
  if (forcedTest) {
    record("EMAIL_TEST_MODE");
    return { status: "sent", mode: "test" };
  }
  if (!key) {
    record("RESEND_API_KEY not set");
    return { status: "sent", mode: "test" };
  }
  const from = configuredFrom || "Zennith Health <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Set up your Zennith patient account",
        html: emailHtml(name, link, username),
      }),
    });
    // The sandbox sender can only ever reach the account owner, so even a
    // successful send through it is not "live".
    if (res.ok)
      return { status: "sent", mode: sandboxSender ? "test" : "live" };
    const detail = await res.text().catch(() => "");
    // Resend refuses a sender whose domain isn't verified (or the sandbox
    // sender to anyone but its owner). That is "not turned on yet", i.e. test
    // mode - not something for the receptionist to act on.
    if (res.status === 403 || /verify a domain|testing emails/i.test(detail)) {
      console.warn(
        "[patient-invite] Resend refused the sender (domain not verified?) — treated as test mode. TODO: verify sending domain before production:",
        detail.slice(0, 200),
      );
      return { status: "sent", mode: "test" };
    }
    // A real failure. Not shown to the receptionist (the screen says the same
    // thing whether or not it arrives), but never silent.
    console.error(
      "[patient-invite] Resend send failed:",
      res.status,
      detail.slice(0, 200),
    );
    return { status: "sent", mode: "live" };
  } catch (error) {
    console.error("[patient-invite] Resend request error:", error);
    return { status: "sent", mode: "live" };
  }
}

/* ---------------- 1. reception sends a link ---------------- */

export async function createPatientInvite(args: {
  idToken: unknown;
  patientId: unknown;
  sms: boolean;
  email: boolean;
  loginBy?: "email" | "patient-id";
  /** The browser Firebase key (public by design), for the standard account calls. */
  apiKey?: string;
  requestUrl?: string;
  env?: unknown;
  now?: number;
}): Promise<SendInviteResult> {
  const fs = adminOrNull(args.env);
  if (!fs) return { ok: false, reason: "not-configured" };
  const uid = await verifyIdToken(args.idToken, fs.projectId);
  if (!uid) return { ok: false, reason: "unauthenticated" };
  return createInviteFor(fs, uid, args);
}

/** The part after the caller is known; split out so it can be tested. */
export async function createInviteFor(
  fs: Fs,
  uid: string,
  args: {
    patientId: unknown;
    sms: boolean;
    email: boolean;
    /** Sign in with the Patient ID even though the record has an e-mail. */
    loginBy?: "email" | "patient-id";
    apiKey?: string;
    requestUrl?: string;
    env?: unknown;
    now?: number;
  },
): Promise<SendInviteResult> {
  const now = args.now ?? Date.now();

  const staff = (await fs.get("profiles", uid))?.data;
  if (!staff || (staff.role !== "receptionist" && staff.role !== "admin")) {
    return { ok: false, reason: "not-eligible" };
  }

  const patientId = canonicalPatientId(args.patientId);
  const patient = patientId
    ? (await fs.get("patients", patientId))?.data
    : null;
  if (!patientId || !patient) return { ok: false, reason: "patient-not-found" };
  // Staff act on their own clinic's patients. Either side missing a clinic
  // can't be judged, so only a definite mismatch is refused.
  if (
    staff.clinicId != null &&
    patient.clinicId != null &&
    !sameClinicId(staff.clinicId, patient.clinicId)
  ) {
    return { ok: false, reason: "other-clinic" };
  }

  const existing = await fs.query("profiles", [
    { field: "patientId", op: "EQUAL", value: patientId },
  ]);
  // An account this flow created up front (the e-mail path) and that nobody has
  // finished setting up yet can be sent to again. Anything else is a login the
  // patient already has.
  const pending =
    existing.length === 1 && existing[0].data.createdByInvite === true
      ? existing[0]
      : null;
  if (existing.length > 0 && !pending) {
    return { ok: false, reason: "already-has-account" };
  }

  const userNo = String(patient.userId ?? "");
  const user = userNo ? (await fs.get("users", userNo))?.data : null;
  const fullName = [text(user?.names), text(user?.surname)]
    .filter(Boolean)
    .join(" ");
  const phone = text(user?.contactNum);
  const contactEmail = text(user?.email);

  const wantSms = args.sms === true;
  const wantEmail = args.email === true;
  if ((!wantSms && !wantEmail) || (!phone.trim() && !contactEmail.trim())) {
    return { ok: false, reason: "nothing-to-send" };
  }

  const pendingEmail = pending
    ? normaliseIdentifier(text(pending.data.email))
    : "";
  const login = pending
    ? {
        username: text(pending.data.username),
        authEmail:
          pendingEmail || `${text(pending.data.username)}@${TEST_DOMAIN}`,
        real: !!pendingEmail,
      }
    : loginFor(patientId, args.loginBy === "patient-id" ? "" : contactEmail);
  // Whoever has this e-mail (or username) as a profile already can't be the
  // new account's login; the sign-in box would match two profiles. (A pending
  // account is this patient's own, so it isn't a clash with itself.)
  if (!pending) {
    const clash = await fs.query("profiles", [
      login.real
        ? { field: "email", op: "EQUAL", value: login.username }
        : { field: "username", op: "EQUAL", value: login.username },
    ]);
    if (clash.length > 0) {
      return {
        ok: false,
        reason: login.real ? "email-in-use" : "username-taken",
      };
    }
  }
  // Firebase's own reset e-mail can only go to a real address that is this
  // patient's login.
  const firebaseEmail = wantEmail && login.real && looksLikeEmail(contactEmail);

  const origin = linkOrigin(args.env, args.requestUrl);
  if (!origin) return { ok: false, reason: "server-error" };

  // Throttle: a link can be re-sent, but not in a loop.
  const limitsDoc = await fs.get("patientInviteLimits", patientId);
  const limits = limitsDoc?.data ?? {};
  const lastSentAt = Number(limits.lastSentAt ?? 0);
  if (lastSentAt && now - lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      reason: "cooldown",
      retryAt: lastSentAt + RESEND_COOLDOWN_MS,
    };
  }
  const windowOpen = now - Number(limits.windowStart ?? 0) < DAY_MS;
  const windowStart = windowOpen ? Number(limits.windowStart) : now;
  const sentToday = windowOpen ? Number(limits.sends ?? 0) : 0;
  if (sentToday >= MAX_SENDS_PER_DAY) {
    return { ok: false, reason: "rate-limited", retryAt: windowStart + DAY_MS };
  }

  // Our own link is needed for text messages, and for an e-mail that can't go
  // through Firebase (see the note at the top). A Firebase-only send needs none.
  const needsToken = wantSms || (wantEmail && !firebaseEmail);
  const token = needsToken ? randomHex(16) : "";
  const hash = needsToken ? await sha256Hex(token) : "";
  const expiresAt = now + INVITE_TTL_MS;
  const link = `${origin}/set-password?t=${token}`;

  if (needsToken) {
    await fs.commit([
      {
        set: ["patientInvites", hash],
        data: {
          patientId,
          userNo,
          fullName,
          username: login.username,
          authEmail: login.authEmail,
          // The real contact e-mail goes on the profile; a made-up address
          // never does.
          contactEmail: login.real ? login.username : "",
          createdAt: now,
          createdBy: uid,
          expiresAt,
          usedAt: null,
          revoked: false,
        },
        precondition: { exists: false },
      },
    ]);
  }

  let emailOutcome: InviteChannelOutcome = { status: "skipped" };
  if (wantEmail && firebaseEmail) {
    const sent = await sendFirebaseResetEmail({
      fs,
      apiKey: args.apiKey,
      email: login.authEmail,
      pendingUid: pending?.id,
      profile: {
        username: login.username,
        fullName,
        userNo,
        patientId,
      },
      env: args.env,
      now,
    });
    if ("fail" in sent) {
      // Nothing was sent, and this is a problem the receptionist can act on
      // (an address another login owns): refuse the whole send, so the text
      // doesn't go out either, saying "use your e-mail".
      if (needsToken) await revoke(fs, hash);
      return { ok: false, reason: sent.fail };
    }
    emailOutcome = sent.outcome;
  }

  const [sms, email] = await Promise.all([
    wantSms
      ? deliverSms(phone, smsText(fullName, link, login.username), args.env)
      : Promise.resolve<InviteChannelOutcome>({ status: "skipped" }),
    wantEmail && !firebaseEmail
      ? deliverEmail(contactEmail, fullName, link, login.username, args.env)
      : Promise.resolve<InviteChannelOutcome>(emailOutcome),
  ]);
  const anySent = sms.status === "sent" || email.status === "sent";

  if (!anySent) {
    // Nobody received this link, so it shouldn't stay usable; and since nothing
    // went out it doesn't count against the daily allowance or start a wait.
    if (needsToken) await revoke(fs, hash);
    return { ok: true, username: login.username, sms, email, expiresAt };
  }

  // The link just sent replaces any earlier one.
  const previous = text(limits.activeToken);
  if (needsToken && previous && previous !== hash) await revoke(fs, previous);
  await fs.write("patientInviteLimits", patientId, {
    activeToken: needsToken ? hash : previous,
    lastSentAt: now,
    windowStart,
    sends: sentToday + 1,
  });

  return { ok: true, username: login.username, sms, email, expiresAt };
}

/**
 * The e-mail channel for a patient with a real e-mail address: make sure their
 * sign-in account exists, linked to the patient record, and have Firebase send
 * its own password-reset e-mail to it.
 *
 * Returns the channel's outcome, or `fail` when the account couldn't be made
 * because the address belongs to a login that is in use.
 */
async function sendFirebaseResetEmail(args: {
  fs: Fs;
  apiKey?: string;
  email: string;
  pendingUid?: string;
  profile: {
    username: string;
    fullName: string;
    userNo: string;
    patientId: string;
  };
  env: unknown;
  now: number;
}): Promise<
  { outcome: InviteChannelOutcome } | { fail: "email-in-use" | "server-error" }
> {
  const { fs, apiKey, email, env, now } = args;
  const record = (why: string) =>
    console.info(
      `[email:test] reset e-mail for ${maskedEmail(email)} not sent (${why})`,
    );

  if (readEnv(env, "EMAIL_TEST_MODE") === "true") {
    record("EMAIL_TEST_MODE");
    return { outcome: { status: "sent", mode: "test" } };
  }
  if (!apiKey) {
    // Without the project's key nothing can be created or sent: not live.
    record("no Firebase API key on the server");
    return { outcome: { status: "sent", mode: "test" } };
  }

  // 1. The account.
  if (!args.pendingUid) {
    const create = async () => {
      const res = await fetch(
        `${SIGN_UP_URL}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            // Nobody ever knows this: the patient sets their own through the
            // reset e-mail.
            password: crypto.randomUUID() + crypto.randomUUID().toUpperCase(),
            returnSecureToken: true,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        localId?: string;
        idToken?: string;
        error?: { message?: string };
      };
      return { res, body };
    };

    let made = await create();
    if (!made.res.ok && /EMAIL_EXISTS/.test(made.body.error?.message ?? "")) {
      // A login with no profile and some age is what a revoke used to leave
      // behind; clear it and try again. One that is in use is left alone.
      const cleared = await deleteLeftoverLogin(fs, email, now).catch(
        () => null,
      );
      if (cleared?.ok && cleared.deleted) made = await create();
    }
    if (!made.res.ok || !made.body.localId) {
      const message = made.body.error?.message ?? "";
      console.error(
        "[patient-invite] account creation refused:",
        made.res.status,
        message.slice(0, 80),
      );
      return {
        fail: /EMAIL_EXISTS/.test(message) ? "email-in-use" : "server-error",
      };
    }
    const uid = made.body.localId;
    try {
      await fs.commit([
        {
          set: ["profiles", uid],
          data: {
            username: args.profile.username,
            role: "patient",
            fullName: args.profile.fullName,
            email,
            legacyUserId: Number(args.profile.userNo) || args.profile.userNo,
            patientId: args.profile.patientId,
            builtin: false,
            createdAt: new Date(now).toISOString(),
            // Marks an account made by a reception invite that nobody has
            // finished setting up (see createInviteFor / completeInviteWith).
            createdByInvite: true,
          },
          precondition: { exists: false },
        },
      ]);
    } catch (error) {
      console.error(
        "[patient-invite] linking the new account failed:",
        error instanceof Error ? error.message : error,
      );
      // Don't leave a sign-in account that isn't linked to anything.
      if (made.body.idToken) {
        await fetch(`${DELETE_URL}?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: made.body.idToken }),
        }).catch(() => undefined);
      }
      return { fail: "server-error" };
    }
  }

  // 2. Firebase's own password-reset e-mail.
  try {
    const res = await fetch(
      `${SEND_OOB_URL}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
      },
    );
    if (!res.ok) {
      // Not shown to the receptionist (the screen says the same thing whether
      // or not it arrives), but never silent. The account exists, so sending
      // again works.
      const detail = await res.text().catch(() => "");
      console.error(
        "[patient-invite] Firebase reset e-mail failed:",
        res.status,
        detail.slice(0, 200),
      );
    }
  } catch (error) {
    console.error(
      "[patient-invite] Firebase reset e-mail request error:",
      error,
    );
  }
  return { outcome: { status: "sent", mode: "live" } };
}

async function revoke(fs: Fs, hash: string): Promise<void> {
  try {
    await fs.write(
      "patientInvites",
      hash,
      { revoked: true },
      { mask: ["revoked"], precondition: { exists: true } },
    );
  } catch (error) {
    // A link that can't be revoked still expires; don't fail the send over it.
    console.error(
      "[patient-invite] couldn't revoke a link:",
      error instanceof Error ? error.message : error,
    );
  }
}

/* ---------------- 2. the patient opens the link ---------------- */

type InviteLookup =
  | {
      ok: true;
      id: string;
      data: Record<string, unknown>;
      /** The account the e-mail path already made for this patient, if any. */
      pendingUid?: string;
    }
  | {
      ok: false;
      reason: "invalid-link" | "expired" | "already-used" | "replaced";
    };

async function readInvite(
  fs: Fs,
  token: unknown,
  now: number,
): Promise<InviteLookup> {
  const raw = typeof token === "string" ? token.trim().toLowerCase() : "";
  if (!TOKEN_PATTERN.test(raw)) return { ok: false, reason: "invalid-link" };
  const id = await sha256Hex(raw);
  const doc = await fs.get("patientInvites", id);
  if (!doc) return { ok: false, reason: "invalid-link" };
  if (doc.data.usedAt != null) return { ok: false, reason: "already-used" };
  if (doc.data.revoked === true) return { ok: false, reason: "replaced" };
  if (Number(doc.data.expiresAt ?? 0) <= now)
    return { ok: false, reason: "expired" };
  // The patient may have got a login another way since the link was sent. The
  // exception is the account the e-mail path made up front and nobody has set
  // up yet: the link finishes that one (see completeInviteWith).
  const accounts = await fs.query("profiles", [
    { field: "patientId", op: "EQUAL", value: doc.data.patientId },
  ]);
  const pending =
    accounts.length === 1 && accounts[0].data.createdByInvite === true
      ? accounts[0].id
      : undefined;
  if (accounts.length > 0 && !pending) {
    return { ok: false, reason: "already-used" };
  }
  return { ok: true, id, data: doc.data, pendingUid: pending };
}

export async function previewInvite(
  token: unknown,
  env?: unknown,
  now = Date.now(),
): Promise<InvitePreview> {
  const fs = adminOrNull(env);
  if (!fs) return { ok: false, reason: "server-error" };
  return previewInviteWith(fs, token, now);
}

export async function previewInviteWith(
  fs: Fs,
  token: unknown,
  now = Date.now(),
): Promise<InvitePreview> {
  const found = await readInvite(fs, token, now);
  if (!found.ok) return found;
  return {
    ok: true,
    firstName: firstName(text(found.data.fullName)),
    username: text(found.data.username),
  };
}

export async function completeInvite(args: {
  token: unknown;
  password: unknown;
  apiKey?: string;
  env?: unknown;
  now?: number;
}): Promise<CompleteInviteResult> {
  const fs = adminOrNull(args.env);
  if (!fs) return { ok: false, reason: "not-configured" };
  return completeInviteWith(fs, args);
}

export async function completeInviteWith(
  fs: Fs,
  args: { token: unknown; password: unknown; apiKey?: string; now?: number },
): Promise<CompleteInviteResult> {
  const now = args.now ?? Date.now();
  const password = typeof args.password === "string" ? args.password : "";
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, reason: "weak-password" };
  }
  if (!args.apiKey) return { ok: false, reason: "not-configured" };

  const found = await readInvite(fs, args.token, now);
  if (!found.ok) return found;
  const invite = found.data;
  const patientId = text(invite.patientId);

  // The patient record must still be there.
  if (!(await fs.get("patients", patientId)))
    return { ok: false, reason: "invalid-link" };

  // The e-mail path already made this patient's account: set its password
  // instead of creating a second one. Only while it has never been signed in
  // to, so a link can't be used to take over a login that is in use.
  if (found.pendingUid) {
    const looked = await fs.identity("accounts:lookup", {
      localId: [found.pendingUid],
    });
    const user = Array.isArray(looked.json.users) ? looked.json.users[0] : null;
    if (!looked.ok || !user) {
      console.error(
        "[patient-invite] couldn't look up the pending account:",
        looked.status,
      );
      return { ok: false, reason: "server-error" };
    }
    if (user.lastLoginAt) return { ok: false, reason: "already-used" };
    const updated = await fs.identity("accounts:update", {
      localId: found.pendingUid,
      password,
    });
    if (!updated.ok) {
      const weak = /WEAK_PASSWORD/.test(JSON.stringify(updated.json));
      console.error(
        "[patient-invite] couldn't set the password:",
        updated.status,
      );
      return { ok: false, reason: weak ? "weak-password" : "server-error" };
    }
    await fs.write(
      "patientInvites",
      found.id,
      { usedAt: now, usedByUid: found.pendingUid },
      { mask: ["usedAt", "usedByUid"], precondition: { exists: true } },
    );
    return { ok: true, username: text(invite.username) };
  }

  // The standard account-creation call (what the app's own sign-up uses), so
  // this needs no extra Google permission. Returns the new account's token,
  // which is only used to undo the creation if the profile can't be written.
  const created = await fetch(
    `${SIGN_UP_URL}?key=${encodeURIComponent(args.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: text(invite.authEmail),
        password,
        returnSecureToken: true,
      }),
    },
  );
  const body = (await created.json().catch(() => ({}))) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };
  if (!created.ok || !body.localId) {
    const message = body.error?.message ?? "";
    console.error(
      "[patient-invite] account creation refused:",
      created.status,
      message.slice(0, 80),
    );
    if (/EMAIL_EXISTS/.test(message))
      return { ok: false, reason: "email-in-use" };
    if (/WEAK_PASSWORD/.test(message))
      return { ok: false, reason: "weak-password" };
    return { ok: false, reason: "server-error" };
  }
  const newUid = body.localId;

  try {
    // Both or neither: the profile that links the account to the patient, and
    // the link being marked used (so a second tap can't make a second account).
    await fs.commit([
      {
        set: ["profiles", newUid],
        data: {
          username: text(invite.username),
          role: "patient",
          fullName: text(invite.fullName),
          email: text(invite.contactEmail),
          legacyUserId: Number(invite.userNo) || text(invite.userNo),
          patientId,
          builtin: false,
          createdAt: new Date(now).toISOString(),
        },
        precondition: { exists: false },
      },
      {
        update: ["patientInvites", found.id],
        data: { usedAt: now, usedByUid: newUid },
      },
    ]);
  } catch (error) {
    console.error(
      "[patient-invite] linking the new account failed:",
      error instanceof WriteConflict
        ? "conflict"
        : error instanceof Error
          ? error.message
          : error,
    );
    // Don't leave a sign-in account that isn't linked to anything.
    if (body.idToken) {
      await fetch(`${DELETE_URL}?key=${encodeURIComponent(args.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: body.idToken }),
      }).catch(() => undefined);
    }
    return { ok: false, reason: "server-error" };
  }

  return { ok: true, username: text(invite.username) };
}
