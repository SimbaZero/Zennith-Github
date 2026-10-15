import { createServerFn } from "@tanstack/react-start";

// Giving a receptionist-registered patient a login of their own: the server
// functions the registration page and the set-password page call. The work
// happens in src/server/patient-invite.ts, loaded inside each handler so none
// of it (or the service-account code it uses) ends up in the browser bundle.
//
// The flow:
//   1. Reception registers the patient (phone and/or email on their record).
//   2. Reception chooses to send a set-password link by SMS, email, or both
//      (sendPatientInvite). The numbers and addresses come from the patient's
//      record on the server, never from the request.
//   3. The patient opens /set-password?t=…, chooses a password
//      (completePatientInvite) and that creates their sign-in account, linked
//      to the patient record.

/**
 * Why a channel could not be used at all: only things the receptionist can fix
 * (nothing on file, or a number that isn't a mobile). Whether a message that
 * was handed to the provider actually arrived is deliberately not reported.
 */
export type InviteChannelFailure = "no-phone" | "not-a-mobile" | "no-email";

/**
 * "live": handed to the real provider. "test": the messaging channel isn't
 * turned on for real recipients yet (test mode, not configured, or an
 * unverified sender), so the attempt was recorded on the server and nothing
 * reached the patient. The server decides this, per channel, from its own
 * configuration - the page never assumes it.
 */
export type InviteChannelMode = "live" | "test";

export type InviteChannelOutcome =
  /** Not asked for. */
  | { status: "skipped" }
  | { status: "sent"; mode: InviteChannelMode }
  | { status: "failed"; reason: InviteChannelFailure };

export type InviteFailure =
  | "not-configured"
  | "unauthenticated"
  | "not-eligible"
  | "patient-not-found"
  | "other-clinic"
  | "already-has-account"
  | "email-in-use"
  | "username-taken"
  | "nothing-to-send"
  | "cooldown"
  | "rate-limited"
  | "server-error";

/**
 * What the patient signs in with. "email" (the default) uses their e-mail
 * address when the record has one; "patient-id" uses their Patient ID, which is
 * the way round an e-mail address that another account already owns.
 */
export type InviteLoginBy = "email" | "patient-id";

export type SendInviteResult =
  | {
      ok: true;
      /** What the patient signs in with: their e-mail, or their Patient ID. */
      username: string;
      sms: InviteChannelOutcome;
      email: InviteChannelOutcome;
      expiresAt: number;
    }
  | { ok: false; reason: InviteFailure; retryAt?: number };

export type InviteLinkFailure =
  | "invalid-link"
  | "expired"
  | "already-used"
  | "replaced";

export type InvitePreview =
  | { ok: true; firstName: string; username: string }
  | { ok: false; reason: InviteLinkFailure | "server-error" };

export type CompleteInviteFailure =
  | InviteLinkFailure
  | "weak-password"
  | "email-in-use"
  | "not-configured"
  | "server-error";

export type CompleteInviteResult =
  | { ok: true; username: string }
  | { ok: false; reason: CompleteInviteFailure };

export const MIN_INVITE_PASSWORD_LENGTH = 6;

/**
 * Which of the numbers typed at the desk to keep as the patient's contact
 * number. A text can only reach a mobile, so a mobile wins over a landline
 * typed first; with no mobile at all, the first number given is kept, as
 * before. (Mirrors the mobile ranges in toSouthAfricanMobile, smsportal.ts,
 * which is server-only and so can't be imported here.)
 */
export function preferMobileNumber(home: string, alternate: string): string {
  const isMobile = (raw: string) => {
    let d = raw.replace(/[\s().-]/g, "").replace(/^(\+|00)/, "");
    if (/^0\d{9}$/.test(d)) d = `27${d.slice(1)}`;
    return /^27(6\d|7[1-46-9]|8[1-4])\d{7}$/.test(d);
  };
  const h = home.trim();
  const a = alternate.trim();
  if (h && isMobile(h)) return h;
  if (a && isMobile(a)) return a;
  return h || a;
}

/* ---------------- wording, shared by both pages ---------------- */

export function describeInviteFailure(
  reason: InviteFailure,
  retryAt?: number,
): string {
  switch (reason) {
    case "not-configured":
      return "Sending login links isn't set up on this server yet.";
    case "unauthenticated":
      return "Your session has expired — sign in again to send a login link.";
    case "not-eligible":
      return "Only reception can send a patient's login link.";
    case "patient-not-found":
      return "That patient record couldn't be found.";
    case "other-clinic":
      return "That patient is registered at a different clinic.";
    case "already-has-account":
      return "This patient already has a login. They can use “Forgot password” on the sign-in page.";
    case "email-in-use":
      return "Another account already uses that e-mail address, so it can't be this patient's login. You can correct the e-mail above, have them sign in with their Patient ID instead, or skip sending a login link.";
    case "username-taken":
      return "That Patient ID is already in use as a username, so a login can't be created from it. Skip for now and ask an administrator to look at this record.";
    case "nothing-to-send":
      return "This patient has no mobile number or e-mail address on file to send a link to.";
    case "cooldown": {
      const s = retryAt
        ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
        : 60;
      return `A link was just sent. You can send another in ${s} second${s === 1 ? "" : "s"}.`;
    }
    case "rate-limited":
      return "Too many login links have been sent for this patient today. Try again tomorrow.";
    default:
      return "Something went wrong sending the login link. Please try again.";
  }
}

export function describeChannelFailure(reason: InviteChannelFailure): string {
  switch (reason) {
    case "no-phone":
      return "No mobile number on file.";
    case "not-a-mobile":
      return "The number on file isn't a South African mobile number, so a text can't be sent.";
    case "no-email":
      return "No e-mail address on file.";
  }
}

/**
 * What the receptionist is told about a message that was sent.
 *
 * In test mode that is stated plainly. Once live, the wording is the same
 * whether or not the message actually arrives (a wrong number, a full inbox),
 * so the screen never confirms or denies delivery - the usual practice for
 * anything that sends a sign-in link.
 */
export function describeSentChannel(
  channel: "sms" | "email",
  mode: InviteChannelMode,
): string {
  if (mode === "test") {
    return "Test mode — this will be sent for real once messaging is turned on.";
  }
  return channel === "sms"
    ? "If this number is reachable, a link to set their password has been sent."
    : "If this email is reachable, a link to set their password has been sent.";
}

export function describeLinkFailure(
  reason: InviteLinkFailure | CompleteInviteFailure | "server-error",
): string {
  switch (reason) {
    case "expired":
      return "This link has expired. Ask the clinic's reception to send you a new one.";
    case "already-used":
      return "This link has already been used. Sign in with your username and password, or use “Forgot password”.";
    case "replaced":
      return "A newer link has been sent to you since this one. Please use the most recent message.";
    case "weak-password":
      return `Choose a password of at least ${MIN_INVITE_PASSWORD_LENGTH} characters.`;
    case "email-in-use":
      return "An account already exists for your e-mail address. Sign in, or use “Forgot password” — or ask the clinic to send you a new link that uses your Patient ID to sign in.";
    case "not-configured":
      return "Setting a password isn't available right now. Please try again later or ask the clinic.";
    case "invalid-link":
      return "This link isn't valid. Check you opened the whole link from the message, or ask the clinic for a new one.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/* ---------------- server functions ---------------- */

/** What the server needs to know about the page the request came from. */
async function requestUrl(): Promise<string | undefined> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return getRequest().url;
  } catch {
    return undefined;
  }
}

export const sendPatientInvite = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      idToken: string;
      patientId: string;
      sms: boolean;
      email: boolean;
      loginBy?: InviteLoginBy;
    }) => d,
  )
  .handler(async ({ data }): Promise<SendInviteResult> => {
    try {
      const { createPatientInvite } = await import("../server/patient-invite");
      return await createPatientInvite({
        idToken: data?.idToken,
        patientId: data?.patientId,
        sms: data?.sms === true,
        email: data?.email === true,
        loginBy: data?.loginBy === "patient-id" ? "patient-id" : "email",
        // The browser Firebase key, which is public by design: used for the
        // standard account and password-reset calls, so no extra permission.
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        requestUrl: await requestUrl(),
      });
    } catch (error) {
      console.error("[patient-invite] send failed:", error);
      return { ok: false, reason: "server-error" };
    }
  });

export const previewPatientInvite = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => d)
  .handler(async ({ data }): Promise<InvitePreview> => {
    try {
      const { previewInvite } = await import("../server/patient-invite");
      return await previewInvite(data?.token);
    } catch (error) {
      console.error("[patient-invite] preview failed:", error);
      return { ok: false, reason: "server-error" };
    }
  });

export const completePatientInvite = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; password: string }) => d)
  .handler(async ({ data }): Promise<CompleteInviteResult> => {
    try {
      const { completeInvite } = await import("../server/patient-invite");
      return await completeInvite({
        token: data?.token,
        password: data?.password,
        // The browser Firebase key, which is public by design; used for the
        // standard account-creation call, so no extra permission is needed.
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      });
    } catch (error) {
      console.error("[patient-invite] complete failed:", error);
      return { ok: false, reason: "server-error" };
    }
  });
