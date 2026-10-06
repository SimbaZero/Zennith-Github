// Server-only: text-message sign-in codes for patients, the alternative
// second factor for people without an authenticator app. Called through the
// server functions in src/lib/sms-otp.ts.
//
// Everything that matters happens here: the code is generated, hashed,
// stored, sent and checked without ever reaching the browser. The caller is
// identified by a verified Firebase ID token, and the phone number comes from
// the patient's record (users/{legacyUserId}.contactNum), never from the
// request.
//
// State lives in collections firestore.rules deny to every client; this code
// reaches them as the service account:
//   smsChallenges/{uid}              the current code (hashed), attempt and send
//                                    counters, and verifiedPhone: the number this
//                                    account has proved it receives texts on
//   smsPhoneLimits/{number}          sends to a number from accounts that haven't
//                                    verified it
//   smsVerifiedPhoneLimits/{number}  sends to a number from the account that most
//                                    recently verified it (the "holder")
//   smsGlobalLimits/daily            all unverified sends, app-wide
import type { SendSmsCodeResult, SmsCodeFailure, VerifySmsCodeResult } from "../lib/sms-otp";
import { isSmsConfigured, isSmsTestMode, sendSms, toSouthAfricanMobile } from "../lib/smsportal";
import { readEnv } from "./env";
import { verifyIdToken } from "./firebase-auth";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
  type FirestoreDoc,
  type FirestoreWrite,
  WriteConflict,
} from "./firestore-admin";

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const SEND_WINDOW_MS = 60 * 60_000;
const MAX_SENDS_PER_WINDOW = 5;
// Wrong guesses across all codes: resending resets the per-code attempts, so
// without this someone with the password could keep guessing indefinitely.
const ATTEMPT_WINDOW_MS = 24 * 60 * 60_000;
const MAX_ATTEMPTS_PER_ATTEMPT_WINDOW = 20;

// Numbers entered at self-signup aren't verified, so sends from an account
// that hasn't proved it receives texts on its number count against that number
// and against an app-wide daily budget. The account that most recently
// verified a number (its "holder") instead gets a separate per-number
// allowance that no other account can use up, so nobody can lock the patient
// who holds a number out; other accounts on the number stay on the shared
// limits, so extra accounts can't multiply the texts it gets.
const MAX_UNVERIFIED_SENDS_PER_PHONE = 10;
const MAX_VERIFIED_SENDS_PER_PHONE = 10;
// Far above normal sign-in use, but bounds what one verified number costs.
const MAX_VERIFIED_SENDS_PER_PHONE_PER_DAY = 30;
const DAILY_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_UNVERIFIED_SENDS_PER_DAY = 200;
// Reservations pinned to shared counters can lose a race; retry, with a
// short random wait so simultaneous requests spread out, before saying "busy".
const MAX_RESERVE_TRIES = 5;

/** SMS_OTP_UNVERIFIED_DAILY_LIMIT as a whole number (0 = none), else the default. */
function unverifiedDailyLimit(env: unknown): number {
  const raw = readEnv(env, "SMS_OTP_UNVERIFIED_DAILY_LIMIT");
  if (raw == null) return DEFAULT_UNVERIFIED_SENDS_PER_DAY;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
  console.warn(`[sms-otp] SMS_OTP_UNVERIFIED_DAILY_LIMIT "${raw}" isn't a whole number; using ${DEFAULT_UNVERIFIED_SENDS_PER_DAY}`);
  return DEFAULT_UNVERIFIED_SENDS_PER_DAY;
}

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

/** A rolling counter stored as { windowStart, sends }: the count still in the window. */
function windowCount(doc: FirestoreDoc | null, windowMs: number, now: number) {
  const open = now - Number(doc?.data.windowStart ?? 0) < windowMs;
  return { windowStart: open ? Number(doc?.data.windowStart) : now, sends: open ? Number(doc?.data.sends ?? 0) : 0 };
}

/** Pin a write to the version read, or to "still doesn't exist". */
function pinnedTo(doc: FirestoreDoc | null) {
  return doc?.updateTime ? { updateTime: doc.updateTime } : { exists: false };
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

  // Reserve the send before calling SMSPortal, in one atomic write pinned to
  // the state just read: a burst of parallel requests produces one text and
  // leaves no counter changed by the requests that lost. A lost race re-reads
  // and tries again, so a double-click gets "cooldown" rather than "busy".
  const code = randomCode();
  const salt = randomHex(16);
  const codeHash = await hashCode(salt, code);
  let reserved: Reserved | undefined;
  for (let tries = 1; !reserved; tries++) {
    const outcome = await reserveSend(fs, patient.uid, phone, { codeHash, salt }, env);
    if ("reserved" in outcome) reserved = outcome.reserved;
    else if (outcome.result.ok || outcome.result.reason !== "busy" || tries >= MAX_RESERVE_TRIES) return outcome.result;
    else await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * tries));
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
    // retry straight away, and give back the app-wide slot (failed texts aren't
    // billed). The per-account and per-number counts stay, which bounds retries.
    // Both are best effort, pinned so they never undo someone else's write.
    await fs
      .write(
        "smsChallenges",
        patient.uid,
        { sentAt: reserved.previousSentAt },
        { mask: ["sentAt", "codeHash", "salt", "expiresAt"], precondition: { updateTime: reserved.challengeVersion } },
      )
      .catch(() => {});
    if (reserved.globalWindowStart !== undefined) {
      await giveBackGlobalSlot(fs, reserved.globalWindowStart).catch(() => {});
    }
    return { ok: false, reason: "send-failed" };
  }
  // Test mode sends nothing, so the code is only in the server log. Never
  // enable SMSPORTAL_TEST_MODE in production.
  if (testMode) console.info(`[sms-otp] TEST MODE, not delivered. Code for ${patient.uid}: ${code}`);

  return { ok: true, phoneLast4: phone.slice(-4), resendAt: reserved.sentAt + RESEND_COOLDOWN_MS };
}

interface Reserved {
  sentAt: number;
  previousSentAt: number;
  challengeVersion: string;
  /** Set when this send used an app-wide slot, to give it back if the text fails. */
  globalWindowStart?: number;
}

/**
 * Takes one send back off the app-wide counter, as long as it's still the
 * same daily window. Other sends may have changed the counter since, so this
 * re-reads and retries rather than restoring an old value.
 */
async function giveBackGlobalSlot(fs: FirestoreAdmin, windowStart: number) {
  for (let tries = 0; tries < 3; tries++) {
    const doc = await fs.get("smsGlobalLimits", "daily");
    const sends = Number(doc?.data.sends ?? 0);
    if (!doc?.updateTime || Number(doc.data.windowStart) !== windowStart || sends <= 0) return;
    try {
      await fs.write("smsGlobalLimits", "daily", { windowStart, sends: sends - 1 }, { precondition: { updateTime: doc.updateTime } });
      return;
    } catch (error) {
      if (!(error instanceof WriteConflict)) throw error;
    }
  }
}

/** Checks every limit against fresh reads and, if all allow it, reserves the send. */
async function reserveSend(
  fs: FirestoreAdmin,
  uid: string,
  phone: string,
  material: { codeHash: string; salt: string },
  env: unknown,
): Promise<{ result: SendSmsCodeResult } | { reserved: Reserved }> {
  const now = Date.now();
  const challenge = await fs.get("smsChallenges", uid);
  const prev = challenge?.data ?? {};

  // Locked after too many wrong codes: a new code would only let guessing continue.
  const attemptWindowOpen = now - Number(prev.attemptWindowStart ?? 0) < ATTEMPT_WINDOW_MS;
  if (attemptWindowOpen && Number(prev.attemptsInWindow ?? 0) >= MAX_ATTEMPTS_PER_ATTEMPT_WINDOW) {
    return { result: { ok: false, reason: "rate-limited", retryAt: Number(prev.attemptWindowStart) + ATTEMPT_WINDOW_MS } };
  }

  const previousSentAt = Number(prev.sentAt ?? 0);
  if (now - previousSentAt < RESEND_COOLDOWN_MS) {
    // Still valid for someone who refreshed the page: the code already sent works.
    return {
      result: { ok: false, reason: "cooldown", retryAt: previousSentAt + RESEND_COOLDOWN_MS, phoneLast4: phone.slice(-4) },
    };
  }
  const own = windowCount(challenge, SEND_WINDOW_MS, now);
  if (own.sends >= MAX_SENDS_PER_WINDOW) {
    return { result: { ok: false, reason: "rate-limited", retryAt: own.windowStart + SEND_WINDOW_MS } };
  }

  const writes: FirestoreWrite[] = [];
  const phoneKey = phone.slice(1);
  let globalWindowStart: number | undefined;
  const verifiedDoc = prev.verifiedPhone === phone ? await fs.get("smsVerifiedPhoneLimits", phoneKey) : null;
  if (verifiedDoc?.data.holder === uid) {
    const perPhone = windowCount(verifiedDoc, SEND_WINDOW_MS, now);
    if (perPhone.sends >= MAX_VERIFIED_SENDS_PER_PHONE) {
      return { result: { ok: false, reason: "rate-limited", retryAt: perPhone.windowStart + SEND_WINDOW_MS } };
    }
    const dayOpen = now - Number(verifiedDoc.data.dayStart ?? 0) < DAILY_WINDOW_MS;
    const dayStart = dayOpen ? Number(verifiedDoc.data.dayStart) : now;
    const daySends = dayOpen ? Number(verifiedDoc.data.daySends ?? 0) : 0;
    if (daySends >= MAX_VERIFIED_SENDS_PER_PHONE_PER_DAY) {
      return { result: { ok: false, reason: "rate-limited", retryAt: dayStart + DAILY_WINDOW_MS } };
    }
    writes.push({
      set: ["smsVerifiedPhoneLimits", phoneKey],
      data: { holder: uid, ...perPhone, sends: perPhone.sends + 1, dayStart, daySends: daySends + 1 },
      precondition: pinnedTo(verifiedDoc),
    });
  } else {
    const phoneDoc = await fs.get("smsPhoneLimits", phoneKey);
    const perPhone = windowCount(phoneDoc, SEND_WINDOW_MS, now);
    if (perPhone.sends >= MAX_UNVERIFIED_SENDS_PER_PHONE) {
      return { result: { ok: false, reason: "rate-limited", retryAt: perPhone.windowStart + SEND_WINDOW_MS } };
    }
    const globalDoc = await fs.get("smsGlobalLimits", "daily");
    const global = windowCount(globalDoc, DAILY_WINDOW_MS, now);
    const dailyLimit = unverifiedDailyLimit(env);
    if (global.sends >= dailyLimit) {
      console.warn(`[sms-otp] app-wide daily limit of ${dailyLimit} unverified sends reached`);
      return { result: { ok: false, reason: "rate-limited", retryAt: global.windowStart + DAILY_WINDOW_MS } };
    }
    writes.push({
      set: ["smsPhoneLimits", phoneKey],
      data: { ...perPhone, sends: perPhone.sends + 1 },
      precondition: pinnedTo(phoneDoc),
    });
    globalWindowStart = global.windowStart;
    writes.push({
      set: ["smsGlobalLimits", "daily"],
      data: { ...global, sends: global.sends + 1 },
      precondition: pinnedTo(globalDoc),
    });
  }

  writes.push({
    set: ["smsChallenges", uid],
    data: {
      codeHash: material.codeHash,
      salt: material.salt,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      phone,
      sentAt: now,
      windowStart: own.windowStart,
      sends: own.sends + 1,
      // Carried over: these outlive any one code.
      verifiedPhone: typeof prev.verifiedPhone === "string" ? prev.verifiedPhone : undefined,
      attemptWindowStart: attemptWindowOpen ? Number(prev.attemptWindowStart) : undefined,
      attemptsInWindow: attemptWindowOpen ? Number(prev.attemptsInWindow ?? 0) : undefined,
    },
    precondition: pinnedTo(challenge),
  });

  try {
    const versions = await fs.commit(writes);
    return {
      reserved: {
        sentAt: now,
        previousSentAt,
        challengeVersion: versions.at(-1) ?? "",
        globalWindowStart,
      },
    };
  } catch (error) {
    if (error instanceof WriteConflict) return { result: { ok: false, reason: "busy" } };
    throw error;
  }
}

/* ---------------- verify ---------------- */

export async function checkSmsCode(idToken: unknown, rawCode: unknown, env?: unknown): Promise<VerifySmsCodeResult> {
  const fs = adminOrNull(env);
  if (!fs) return { ok: false, reason: "not-configured" };

  const patient = await eligiblePatient(fs, idToken);
  if (!patient.ok) return { ok: false, reason: patient.reason };

  const code = String(rawCode ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid-code" };

  const now = Date.now();
  const challenge = await fs.get("smsChallenges", patient.uid);
  const c = challenge?.data;
  if (!challenge?.updateTime || !c?.codeHash || now > Number(c.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  const attempts = Number(c.attempts ?? 0);
  const attemptWindowOpen = now - Number(c.attemptWindowStart ?? 0) < ATTEMPT_WINDOW_MS;
  const attemptWindowStart = attemptWindowOpen ? Number(c.attemptWindowStart) : now;
  const attemptsInWindow = attemptWindowOpen ? Number(c.attemptsInWindow ?? 0) : 0;
  if (attempts >= MAX_ATTEMPTS || attemptsInWindow >= MAX_ATTEMPTS_PER_ATTEMPT_WINDOW) {
    return { ok: false, reason: "too-many-attempts" };
  }

  // Count the attempt before comparing, pinned to the version just read:
  // parallel guesses conflict here instead of sharing one attempt.
  let counted: string;
  try {
    counted = await fs.write(
      "smsChallenges",
      patient.uid,
      { attempts: attempts + 1, attemptWindowStart, attemptsInWindow: attemptsInWindow + 1 },
      { mask: ["attempts", "attemptWindowStart", "attemptsInWindow"], precondition: { updateTime: challenge.updateTime } },
    );
  } catch (error) {
    if (error instanceof WriteConflict) return { ok: false, reason: "busy" };
    throw error;
  }

  if (!sameHash(await hashCode(String(c.salt), code), String(c.codeHash))) {
    const attemptsLeft = Math.min(MAX_ATTEMPTS - attempts, MAX_ATTEMPTS_PER_ATTEMPT_WINDOW - attemptsInWindow) - 1;
    return attemptsLeft > 0
      ? { ok: false, reason: "invalid-code", attemptsLeft }
      : { ok: false, reason: "too-many-attempts" };
  }

  // Burn the code so it can't be used twice, and record the number this
  // account has now proved it receives texts on. The daily attempt count goes
  // back to what it was, since only wrong codes should use it up. The send
  // counters stay, so a successful sign-in doesn't reset the rate limit.
  const verifiedPhone = typeof c.phone === "string" ? c.phone : undefined;
  try {
    await fs.write(
      "smsChallenges",
      patient.uid,
      { verifiedPhone, attemptsInWindow },
      {
        mask: ["codeHash", "salt", "expiresAt", "attemptsInWindow", ...(verifiedPhone ? ["verifiedPhone"] : [])],
        precondition: { updateTime: counted },
      },
    );
  } catch (error) {
    if (error instanceof WriteConflict) return { ok: false, reason: "busy" };
    throw error;
  }

  // This account now holds the number: only the latest account to verify a
  // number gets its verified allowance, so accounts that verified it in the
  // past (an earlier owner, a borrowed phone) can't use it up.
  if (verifiedPhone) {
    await fs
      .write("smsVerifiedPhoneLimits", verifiedPhone.slice(1), { holder: patient.uid }, { mask: ["holder"] })
      .catch((error) => console.error("[sms-otp] couldn't record the number's holder:", error));
  }

  // The first verified code turns text-message sign-in on for this account.
  // Only the server writes this field; firestore.rules stop the owner changing it.
  if (!patient.enrolled) {
    await fs.write("profiles", patient.uid, { twoFactorMethod: "sms" }, { mask: ["twoFactorMethod"], precondition: { exists: true } });
  }
  return { ok: true };
}
