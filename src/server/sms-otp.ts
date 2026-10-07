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
//   smsChallenges/{uid}                the current code (hashed), attempt and
//                                      send counters, and verifiedPhone: the
//                                      number this account has proved it
//                                      receives texts on
//   smsVerifiedPhones/{number}         the accounts that have proved they
//                                      receive texts on the number, with when
//                                      each last did
//   smsVerifiedPhoneDays/{number_day}  texts to a number from those accounts,
//                                      per UTC day
//   smsPhoneLimits/{number}            sends to a number from accounts that
//                                      haven't verified it
//   smsGlobalLimits/{day}              all such unverified sends, app-wide,
//                                      per UTC day
import type { SendSmsCodeResult, SmsCodeFailure, VerifySmsCodeResult } from "../lib/sms-otp";
import { isSmsConfigured, isSmsTestMode, sendSms, toSouthAfricanMobile } from "../lib/smsportal";
import { readEnv } from "./env";
import { verifyIdToken } from "./firebase-auth";
import {
  type CommitResult,
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
  type FirestoreData,
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
// and against an app-wide daily budget, which anyone can use up. Once an
// account has verified its number, its sends come out of its own daily
// allowance instead, which no other account can touch: an outsider signing up
// with a family's number can't lock any of the family out. Only the accounts
// that verified a number most recently get this, and only for a while after
// they last did.
const MAX_UNVERIFIED_SENDS_PER_PHONE = 10;
const MAX_VERIFIED_SENDS_PER_DAY = 15;
const MAX_VERIFIED_ACCOUNTS_PER_PHONE = 5;
const VERIFIED_FOR_MS = 90 * 24 * 60 * 60_000;
// What a number's listed accounts can use between them. Only reached by
// cycling new accounts through the list, which would otherwise give one SIM a
// fresh allowance per account.
const MAX_VERIFIED_SENDS_PER_PHONE_PER_DAY = MAX_VERIFIED_ACCOUNTS_PER_PHONE * MAX_VERIFIED_SENDS_PER_DAY;
const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_UNVERIFIED_SENDS_PER_DAY = 200;
// Writes pinned to what was read can lose a race; retry, with a short random
// wait so simultaneous requests spread out, before saying "busy".
const MAX_WRITE_TRIES = 5;

// The challenge fields a send changes, split by whether a send that is taken
// back gets them back: a text that failed keeps its hourly counts, which
// bounds retries; a send refused at a daily cap gets those back too.
const CODE_FIELDS = ["codeHash", "salt", "expiresAt", "attempts", "phone", "sentAt", "verifiedDay", "verifiedDaySends"];
const HOURLY_FIELDS = ["windowStart", "sends"];

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

/** A rolling counter: when its window opened, and the count still inside it. */
function rolling(start: unknown, count: unknown, windowMs: number, now: number) {
  const open = now - Number(start ?? 0) < windowMs;
  return { start: open ? Number(start) : now, count: open ? Number(count ?? 0) : 0 };
}

/** The UTC day `now` is in ("2026-10-07"), which names the daily counters, and when it ends. */
function utcDay(now: number) {
  const id = new Date(now).toISOString().slice(0, 10);
  return { id, endsAt: Date.parse(id) + DAY_MS };
}

/** The accounts on a smsVerifiedPhones doc that still count as verified, with when each last verified. */
function verifiedAccounts(doc: FirestoreDoc | null, now: number): Map<string, number> {
  const recorded = doc?.data.accounts;
  const found = new Map<string, number>();
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) return found;
  for (const [uid, at] of Object.entries(recorded)) {
    if (typeof at === "number" && now - at < VERIFIED_FOR_MS) found.set(uid, at);
  }
  return found;
}

/** Pin a write to the version read, or to "still doesn't exist". */
function pinnedTo(doc: FirestoreDoc | null) {
  return doc?.updateTime ? { updateTime: doc.updateTime } : { exists: false };
}

function waitBeforeRetry(tries: number) {
  return new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * tries));
}

/** An error for the log, without the phone numbers that name some documents. */
function forLog(error: unknown): string {
  return String(error).replace(/\d{9,}/g, "<number>");
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
    else if (outcome.result.ok || outcome.result.reason !== "busy" || tries >= MAX_WRITE_TRIES) return outcome.result;
    else await waitBeforeRetry(tries);
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
    // Nothing was delivered: drop the cooldown so the patient can retry
    // straight away, put back any earlier code, and give back the daily slots
    // the send used (failed texts aren't billed).
    await undoReservation(fs, patient.uid, reserved, { refundHourly: false });
    return { ok: false, reason: "send-failed" };
  }
  // Test mode sends nothing, so the code is only in the server log. Never
  // enable SMSPORTAL_TEST_MODE in production.
  if (testMode) console.info(`[sms-otp] TEST MODE, not delivered. Code for ${patient.uid}: ${code}`);

  return { ok: true, phoneLast4: phone.slice(-4), resendAt: reserved.sentAt + RESEND_COOLDOWN_MS };
}

interface Reserved {
  sentAt: number;
  codeHash: string;
  challengeVersion: string;
  /** The challenge fields this send changed, as they were before it. */
  before: FirestoreData;
  /** The daily counters this send was added to. */
  counters: Array<[collection: string, id: string]>;
  /** Set when this send used the number's unverified hourly count. */
  phoneKey?: string;
}

/**
 * Takes back a send that was reserved but won't be delivered: puts the
 * challenge fields it changed back as they were, so an earlier code that's
 * still valid works again, and takes it off the daily counters. Hourly counts
 * come back only with `refundHourly`. Best effort, and never throws.
 */
async function undoReservation(fs: FirestoreAdmin, uid: string, reserved: Reserved, { refundHourly }: { refundHourly: boolean }) {
  const fields = refundHourly ? [...CODE_FIELDS, ...HOURLY_FIELDS] : CODE_FIELDS;
  const data = Object.fromEntries(fields.map((field) => [field, reserved.before[field]]));
  let version: string | undefined = reserved.challengeVersion;
  for (let tries = 1; version && tries <= MAX_WRITE_TRIES; tries++) {
    try {
      await fs.write("smsChallenges", uid, data, { mask: fields, precondition: { updateTime: version } });
      break;
    } catch (error) {
      if (!(error instanceof WriteConflict)) break;
      // Changed since, e.g. by a code typed while the text was in flight. Only
      // put things back while this send's code is still the current one.
      const latest = await fs.get("smsChallenges", uid).catch(() => null);
      version = latest?.data.codeHash === reserved.codeHash ? latest.updateTime : undefined;
    }
  }

  // Increments never conflict, so these come back even if the challenge couldn't.
  const decrements: FirestoreWrite[] = reserved.counters.map(([collection, id]) => ({
    increment: [collection, id],
    by: { sends: -1 },
  }));
  if (refundHourly && reserved.phoneKey) {
    decrements.push({ increment: ["smsPhoneLimits", reserved.phoneKey], by: { sends: -1 } });
  }
  for (let tries = 1; decrements.length > 0 && tries <= 2; tries++) {
    try {
      await fs.commit(decrements);
      break;
    } catch (error) {
      if (tries === 2) console.error("[sms-otp] couldn't give back a send:", forLog(error));
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
  const day = utcDay(now);
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
  const own = rolling(prev.windowStart, prev.sends, SEND_WINDOW_MS, now);
  if (own.count >= MAX_SENDS_PER_WINDOW) {
    return { result: { ok: false, reason: "rate-limited", retryAt: own.start + SEND_WINDOW_MS } };
  }

  const writes: FirestoreWrite[] = [];
  const phoneKey = phone.slice(1);
  const verified =
    prev.verifiedPhone === phone && verifiedAccounts(await fs.get("smsVerifiedPhones", phoneKey), now).has(uid);

  // Daily counters are incremented rather than pinned, so sends from
  // different accounts never conflict over them, and the count each increment
  // returns is checked after the commit: [counter, index of its write, cap].
  const counted: Array<{ counter: [string, string]; at: number; cap: number }> = [];
  const count = (counter: [string, string], cap: number) => {
    counted.push({ counter, at: writes.length, cap });
    writes.push({ increment: counter, by: { sends: 1 } });
  };

  // A verified account's own daily count lives on its challenge, so no other
  // account's sends can use it up.
  let ownDaySends: number | undefined;
  if (verified) {
    ownDaySends = prev.verifiedDay === day.id ? Number(prev.verifiedDaySends ?? 0) : 0;
    if (ownDaySends >= MAX_VERIFIED_SENDS_PER_DAY) {
      return { result: { ok: false, reason: "rate-limited", retryAt: day.endsAt } };
    }
    count(["smsVerifiedPhoneDays", `${phoneKey}_${day.id}`], MAX_VERIFIED_SENDS_PER_PHONE_PER_DAY);
  } else {
    const phoneDoc = await fs.get("smsPhoneLimits", phoneKey);
    const perPhone = rolling(phoneDoc?.data.windowStart, phoneDoc?.data.sends, SEND_WINDOW_MS, now);
    if (perPhone.count >= MAX_UNVERIFIED_SENDS_PER_PHONE) {
      return { result: { ok: false, reason: "rate-limited", retryAt: perPhone.start + SEND_WINDOW_MS } };
    }
    const dailyLimit = unverifiedDailyLimit(env);
    const globalDoc = await fs.get("smsGlobalLimits", day.id);
    if (Number(globalDoc?.data.sends ?? 0) >= dailyLimit) {
      console.warn(`[sms-otp] app-wide daily limit of ${dailyLimit} unverified sends reached`);
      return { result: { ok: false, reason: "rate-limited", retryAt: day.endsAt } };
    }
    writes.push({
      set: ["smsPhoneLimits", phoneKey],
      data: { windowStart: perPhone.start, sends: perPhone.count + 1 },
      precondition: pinnedTo(phoneDoc),
    });
    count(["smsGlobalLimits", day.id], dailyLimit);
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
      windowStart: own.start,
      sends: own.count + 1,
      verifiedDay: ownDaySends === undefined ? prev.verifiedDay : day.id,
      verifiedDaySends: ownDaySends === undefined ? prev.verifiedDaySends : ownDaySends + 1,
      // Carried over: these outlive any one code.
      verifiedPhone: typeof prev.verifiedPhone === "string" ? prev.verifiedPhone : undefined,
      attemptWindowStart: attemptWindowOpen ? Number(prev.attemptWindowStart) : undefined,
      attemptsInWindow: attemptWindowOpen ? Number(prev.attemptsInWindow ?? 0) : undefined,
    },
    precondition: pinnedTo(challenge),
  });

  let results: CommitResult[];
  try {
    results = await fs.commit(writes);
  } catch (error) {
    if (error instanceof WriteConflict) return { result: { ok: false, reason: "busy" } };
    throw error;
  }
  const reserved: Reserved = {
    sentAt: now,
    codeHash: material.codeHash,
    challengeVersion: results.at(-1)?.updateTime ?? "",
    before: Object.fromEntries([...CODE_FIELDS, ...HOURLY_FIELDS].map((field) => [field, prev[field]])),
    counters: counted.map(({ counter }) => counter),
    phoneKey: verified ? undefined : phoneKey,
  };

  // Sends that read a daily count at the same moment can all get this far;
  // the count after each one's increment says whether it fits. One that
  // doesn't is taken back completely, as if it had been refused up front.
  const over = counted.find(({ at, cap }) => !(Number(results[at]?.transformResults[0]) <= cap));
  if (over) {
    console.warn(`[sms-otp] daily limit reached on ${over.counter[0]}; send refused`);
    await undoReservation(fs, uid, reserved, { refundHourly: true });
    return { result: { ok: false, reason: "rate-limited", retryAt: day.endsAt } };
  }
  return { reserved };
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

  // From now on this account's sends come out of its own allowance. If this
  // can't be recorded the sign-in still succeeds; the account just stays on
  // the shared limits until it next verifies.
  if (verifiedPhone) {
    await recordVerifiedAccount(fs, verifiedPhone.slice(1), patient.uid, now).catch((error) =>
      console.error("[sms-otp] couldn't record the verified number:", forLog(error)),
    );
  }

  // The first verified code turns text-message sign-in on for this account.
  // Only the server writes this field; firestore.rules stop the owner changing it.
  if (!patient.enrolled) {
    await fs.write("profiles", patient.uid, { twoFactorMethod: "sms" }, { mask: ["twoFactorMethod"], precondition: { exists: true } });
  }
  return { ok: true };
}

/**
 * Adds an account to the accounts that have verified a number, or refreshes
 * it. Only the most recent few are kept: when the list is full, accounts that
 * have since verified a different number go first, then the account that
 * verified longest ago. Only someone who receives texts on the number can get
 * onto the list, so nobody else can push a patient off it.
 */
async function recordVerifiedAccount(fs: FirestoreAdmin, phoneKey: string, uid: string, now: number) {
  for (let tries = 1; ; tries++) {
    const doc = await fs.get("smsVerifiedPhones", phoneKey);
    let others = [...verifiedAccounts(doc, now)].filter(([other]) => other !== uid);
    if (others.length >= MAX_VERIFIED_ACCOUNTS_PER_PHONE) {
      // An account that moved to another number gets nothing from this list.
      const challenges = await fs.getMany("smsChallenges", others.map(([other]) => other));
      others = others.filter(([other]) => challenges.get(other)?.data.verifiedPhone === `+${phoneKey}`);
    }
    others = others.sort((a, b) => b[1] - a[1]).slice(0, MAX_VERIFIED_ACCOUNTS_PER_PHONE - 1);
    try {
      await fs.write(
        "smsVerifiedPhones",
        phoneKey,
        { accounts: Object.fromEntries([[uid, now], ...others]) },
        { precondition: pinnedTo(doc) },
      );
      return;
    } catch (error) {
      if (!(error instanceof WriteConflict) || tries >= MAX_WRITE_TRIES) throw error;
      await waitBeforeRetry(tries);
    }
  }
}
