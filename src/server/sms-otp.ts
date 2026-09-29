// Server-only: text-message sign-in codes for patients, the alternative
// second factor for people without an authenticator app. Called through the
// server functions in src/lib/sms-otp.ts.
//
// Everything that matters happens here: the code is generated, hashed,
// stored, sent and checked without ever reaching the browser. The caller is
// identified by a verified Firebase ID token, and the phone number comes from
// the patient's record (users/{legacyUserId}.contactNum), never from the
// request, so a code can only go to the number the clinic holds.
//
// State lives in smsChallenges/{uid} and smsPhoneLimits/{number}, which
// firestore.rules deny to every client; this code reaches them as the
// service account.
import type { SendSmsCodeResult, SmsCodeFailure, VerifySmsCodeResult } from "../lib/sms-otp";
import { isSmsConfigured, isSmsTestMode, sendSms, toSouthAfricanMobile } from "../lib/smsportal";
import { verifyIdToken } from "./firebase-auth";
import { FirestoreConfigError, firestoreAdminFromEnv, type FirestoreAdmin, WriteConflict } from "./firestore-admin";

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const SEND_WINDOW_MS = 60 * 60_000;
const MAX_SENDS_PER_WINDOW = 5;
// Per phone number, across accounts: a new account can point at anyone's
// record (see firestore.rules profiles create), so the per-account limit alone
// wouldn't stop someone flooding one person's phone. Higher than the
// per-account limit so a family sharing a number can still sign in.
const MAX_SENDS_PER_PHONE_WINDOW = 10;

// users docs are keyed by the numeric legacy user ID.
const USER_ID = /^\d{1,20}$/;

/* ---------------- helpers ---------------- */

/** Uniform 6-digit code: rejection-sample so no value is more likely than another. */
function randomCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashCode(salt: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

/**
 * Resolves the caller to a patient allowed to use text-message codes: a
 * patient profile that is either already on SMS or not yet enrolled in any
 * method. Accounts on an authenticator app can't switch themselves; an admin
 * resets them first.
 */
async function eligiblePatient(
  fs: FirestoreAdmin,
  idToken: unknown,
): Promise<{ ok: false; reason: SmsCodeFailure } | { ok: true; uid: string; legacyUserId: unknown; enrolled: boolean }> {
  const uid = await verifyIdToken(idToken, fs.projectId);
  if (!uid) return { ok: false, reason: "unauthenticated" };

  const p = (await fs.get("profiles", uid))?.data;
  const hasTotp = typeof p?.totpSecret === "string" && p.totpSecret !== "";
  if (!p || p.role !== "patient" || hasTotp || (p.twoFactorMethod != null && p.twoFactorMethod !== "sms")) {
    return { ok: false, reason: "not-eligible" };
  }
  return { ok: true, uid, legacyUserId: p.legacyUserId, enrolled: p.twoFactorMethod === "sms" };
}

/* ---------------- send ---------------- */

export async function requestSmsCode(idToken: unknown, env?: unknown): Promise<SendSmsCodeResult> {
  const fs = adminOrNull(env);
  if (!fs || (!isSmsConfigured(env) && !isSmsTestMode(env))) {
    console.warn("[sms-otp] SMSPortal or FIREBASE_SERVICE_ACCOUNT not configured; code not sent");
    return { ok: false, reason: "not-configured" };
  }

  const patient = await eligiblePatient(fs, idToken);
  if (!patient.ok) return { ok: false, reason: patient.reason };

  const legacyUserId = patient.legacyUserId == null ? "" : String(patient.legacyUserId);
  const user = USER_ID.test(legacyUserId) ? await fs.get("users", legacyUserId) : null;
  const phone = toSouthAfricanMobile(user?.data.contactNum);
  if (!phone) return { ok: false, reason: "no-phone" };
  const phoneLast4 = phone.slice(-4);

  const now = Date.now();
  const existing = await fs.get("smsChallenges", patient.uid);
  const prev = existing?.data ?? {};

  const sentAt = Number(prev.sentAt ?? 0);
  if (now - sentAt < RESEND_COOLDOWN_MS) {
    // Still valid for someone who refreshed the page: the code already sent works.
    return { ok: false, reason: "cooldown", retryAt: sentAt + RESEND_COOLDOWN_MS, phoneLast4 };
  }
  const windowOpen = now - Number(prev.windowStart ?? 0) < SEND_WINDOW_MS;
  const windowStart = windowOpen ? Number(prev.windowStart) : now;
  const sends = windowOpen ? Number(prev.sends ?? 0) : 0;
  if (sends >= MAX_SENDS_PER_WINDOW) {
    return { ok: false, reason: "rate-limited", retryAt: windowStart + SEND_WINDOW_MS };
  }

  // Count the send against the phone number, pinned to the state just read.
  const phoneKey = phone.slice(1);
  const phoneDoc = await fs.get("smsPhoneLimits", phoneKey);
  const phoneWindowOpen = now - Number(phoneDoc?.data.windowStart ?? 0) < SEND_WINDOW_MS;
  const phoneWindowStart = phoneWindowOpen ? Number(phoneDoc?.data.windowStart) : now;
  const phoneSends = phoneWindowOpen ? Number(phoneDoc?.data.sends ?? 0) : 0;
  if (phoneSends >= MAX_SENDS_PER_PHONE_WINDOW) {
    return { ok: false, reason: "rate-limited", retryAt: phoneWindowStart + SEND_WINDOW_MS };
  }

  // Reserve the send before calling SMSPortal. Each write is pinned to the
  // state just read, so a burst of parallel requests produces one text
  // message, not one per request.
  const code = randomCode();
  const salt = randomHex(16);
  let reserved: string;
  try {
    await fs.write(
      "smsPhoneLimits",
      phoneKey,
      { windowStart: phoneWindowStart, sends: phoneSends + 1 },
      { precondition: phoneDoc?.updateTime ? { updateTime: phoneDoc.updateTime } : { exists: false } },
    );
    reserved = await fs.write(
      "smsChallenges",
      patient.uid,
      {
        codeHash: await hashCode(salt, code),
        salt,
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        sentAt: now,
        windowStart,
        sends: sends + 1,
      },
      { precondition: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false } },
    );
  } catch (error) {
    if (error instanceof WriteConflict) return { ok: false, reason: "busy" };
    throw error;
  }

  // Plain ASCII keeps this to a single 160-character SMS segment.
  const testMode = isSmsTestMode(env);
  const sent = await sendSms({
    to: phone,
    message: `Zennith: your sign-in code is ${code}. It expires in 5 minutes. Never share it with anyone, including clinic staff.`,
    sensitive: true,
    env,
  });
  if (!sent.ok || (sent.dryRun && !testMode)) {
    // Nothing was delivered: drop the code and the cooldown so the patient can
    // retry straight away. The hourly send counts stay, which bounds retries.
    await fs
      .write(
        "smsChallenges",
        patient.uid,
        { sentAt },
        { mask: ["sentAt", "codeHash", "salt", "expiresAt"], precondition: { updateTime: reserved } },
      )
      .catch(() => {});
    return { ok: false, reason: "send-failed" };
  }
  // Test mode sends nothing, so the code is only in the server log. Never
  // enable SMSPORTAL_TEST_MODE in production.
  if (testMode) console.info(`[sms-otp] TEST MODE, not delivered. Code for ${patient.uid}: ${code}`);

  return { ok: true, phoneLast4, resendAt: now + RESEND_COOLDOWN_MS };
}

/* ---------------- verify ---------------- */

export async function checkSmsCode(idToken: unknown, rawCode: unknown, env?: unknown): Promise<VerifySmsCodeResult> {
  const fs = adminOrNull(env);
  if (!fs) return { ok: false, reason: "not-configured" };

  const patient = await eligiblePatient(fs, idToken);
  if (!patient.ok) return { ok: false, reason: patient.reason };

  const code = String(rawCode ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid-code" };

  const challenge = await fs.get("smsChallenges", patient.uid);
  const c = challenge?.data;
  if (!challenge?.updateTime || !c?.codeHash || Date.now() > Number(c.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  const attempts = Number(c.attempts ?? 0);
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too-many-attempts" };

  // Count the attempt before comparing, pinned to the version just read:
  // parallel guesses conflict here instead of sharing one attempt.
  let counted: string;
  try {
    counted = await fs.write(
      "smsChallenges",
      patient.uid,
      { attempts: attempts + 1 },
      { mask: ["attempts"], precondition: { updateTime: challenge.updateTime } },
    );
  } catch (error) {
    if (error instanceof WriteConflict) return { ok: false, reason: "busy" };
    throw error;
  }

  if (!sameHash(await hashCode(String(c.salt), code), String(c.codeHash))) {
    const attemptsLeft = MAX_ATTEMPTS - attempts - 1;
    return attemptsLeft > 0
      ? { ok: false, reason: "invalid-code", attemptsLeft }
      : { ok: false, reason: "too-many-attempts" };
  }

  // Burn the code so it can't be used twice. The send counters stay, so a
  // successful sign-in doesn't reset the rate limit.
  try {
    await fs.write("smsChallenges", patient.uid, {}, { mask: ["codeHash", "salt", "expiresAt"], precondition: { updateTime: counted } });
  } catch (error) {
    if (error instanceof WriteConflict) return { ok: false, reason: "busy" };
    throw error;
  }

  // The first verified code turns text-message sign-in on for this account.
  // Only the server writes this field; firestore.rules stop the owner changing it.
  if (!patient.enrolled) {
    await fs.write("profiles", patient.uid, { twoFactorMethod: "sms" }, { mask: ["twoFactorMethod"], precondition: { exists: true } });
  }
  return { ok: true };
}
