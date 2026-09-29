// Server-only: runs in the Worker (reminder cron, reply webhook), never in
// the browser. Firestore access goes through the service-account REST client
// because there is no signed-in user here.
import { readEnv } from "../server/env";
import type { FirestoreAdmin, FirestoreWrite } from "../server/firestore-admin";
import { clinicWallClock } from "./clinic-time";

export type SmsReplyAction = "confirm" | "decline";

// https://docs.smsportal.com/reference/bulkmessages_postv3
const SMSPORTAL_SEND_URL = "https://rest.smsportal.com/v3/BulkMessages";

export function formatPhoneForSms(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+27${digits.slice(1)}`;
  if (digits.startsWith("27")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

/**
 * A South African mobile number in E.164 form ("+27821234567"), or null if
 * `raw` isn't one. Stricter than formatPhoneForSms: sign-in codes must only
 * go to a real SA mobile, never to a landline, a toll-free or share-call
 * number (080, 086), VoIP (087) or a malformed number.
 */
export function toSouthAfricanMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/[\s().-]/g, "").replace(/^(\+|00)/, "");
  if (/^0\d{9}$/.test(digits)) digits = `27${digits.slice(1)}`;
  // Mobile ranges: 06x, 071-074, 076-079, 081-084.
  return /^27(6\d|7[1-46-9]|8[1-4])\d{7}$/.test(digits) ? `+${digits}` : null;
}

/** Whether SMSPortal credentials are set, i.e. texts can actually be sent. */
export function isSmsConfigured(env?: unknown): boolean {
  return !!readEnv(env, "SMSPORTAL_CLIENT_ID") && !!readEnv(env, "SMSPORTAL_API_SECRET");
}

/** SMSPORTAL_TEST_MODE=true: log instead of sending (development only). */
export function isSmsTestMode(env?: unknown): boolean {
  return readEnv(env, "SMSPORTAL_TEST_MODE") === "true";
}

export function buildAppointmentReminderText({
  appointmentDate,
  appointmentTime,
  clinician,
  isMorningReply = false,
}: {
  appointmentDate: string;
  appointmentTime: string;
  clinician: string;
  isMorningReply?: boolean;
}) {
  const dateLabel = new Date(`${appointmentDate}T${appointmentTime}:00`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
  const timeLabel = new Date(`${appointmentDate}T${appointmentTime}:00`).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isMorningReply) {
    return `Hello. Please confirm your appointment with ${clinician} on ${dateLabel} at ${timeLabel}. Reply 1 to confirm, 2 to decline.`;
  }

  return `This is a reminder that you have an appointment with ${clinician} on ${dateLabel} at ${timeLabel}. Please reply 1 to confirm or 2 to decline.`;
}

interface SmsPortalSendResponse {
  messages?: number;
  errorReport?: unknown;
}

export async function sendSms({
  to,
  message,
  testMode,
  sensitive = false,
  env,
}: {
  to: string;
  message: string;
  testMode?: boolean;
  /** The message is a secret (a sign-in code): never write it to the log. */
  sensitive?: boolean;
  env?: unknown;
}): Promise<{ ok: boolean; dryRun?: boolean; reason?: string }> {
  const phone = formatPhoneForSms(to);
  if (!phone) return { ok: false, reason: "missing-phone" };

  const clientId = readEnv(env, "SMSPORTAL_CLIENT_ID") ?? "";
  const apiSecret = readEnv(env, "SMSPORTAL_API_SECRET") ?? "";
  const shouldTest = testMode ?? (readEnv(env, "SMSPORTAL_TEST_MODE") === "true");

  if (!clientId || !apiSecret || shouldTest) {
    console.info(`[sms:test] ${phone} :: ${sensitive ? "(message not logged)" : message}`);
    return { ok: true, dryRun: true };
  }

  try {
    const auth = btoa(`${clientId}:${apiSecret}`);
    const res = await fetch(SMSPORTAL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // SMSPortal takes the MSISDN without the leading "+".
      body: JSON.stringify({ messages: [{ destination: phone.replace(/^\+/, ""), content: message }] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[sms] send failed:", res.status, text);
      return { ok: false, reason: `sms-provider:${res.status}` };
    }

    // A 200 can still reject the message (invalid number, opted out): it then
    // reports 0 enqueued messages and lists the problem in errorReport.
    const body = (await res.json().catch(() => null)) as
      | (SmsPortalSendResponse & { sendResponse?: SmsPortalSendResponse })
      | null;
    const report = body?.sendResponse ?? body;
    if (typeof report?.messages === "number" && report.messages < 1) {
      console.error("[sms] message not enqueued:", JSON.stringify(report.errorReport ?? {}));
      return { ok: false, reason: "sms-not-enqueued" };
    }

    return { ok: true };
  } catch (error) {
    console.error("[sms] request error:", error);
    return { ok: false, reason: "sms-error" };
  }
}

/**
 * Pulls the sender and reply text out of an SMSPortal "SMS Replies" webhook.
 *
 * SMSPortal's default POST template sends camelCase JSON (sourcePhoneNumber,
 * incomingData); GET webhooks carry the same values in the query string.
 * Keys are matched case-insensitively, and the older Msisdn/Message names
 * plus plain from/message are still accepted for custom templates.
 * https://docs.smsportal.com/docs/webhook-types-and-variables
 */
export async function readInboundSmsPayload(
  request: Request,
  url: URL,
): Promise<{ from: string; message: string }> {
  const fields = new Map<string, string>();
  const put = (key: string, value: unknown) => {
    if (value == null || typeof value === "object") return;
    fields.set(key.toLowerCase(), String(value));
  };

  url.searchParams.forEach((value, key) => put(key, value));

  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "POST" && contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    form?.forEach((value, key) => put(key, value));
  } else if (request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (contentType.includes("application/x-www-form-urlencoded")) {
      new URLSearchParams(raw).forEach((value, key) => put(key, value));
    } else if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) put(key, value);
        }
      } catch {
        // Not JSON; nothing more to read.
      }
    }
  }

  const pick = (...names: string[]) =>
    names.map((name) => fields.get(name)).find((value) => value !== undefined && value !== "") ?? "";

  return {
    from: pick("sourcephonenumber", "msisdn", "from"),
    message: pick("incomingdata", "message", "text", "body"),
  };
}

/**
 * The appointment a reply refers to: the soonest upcoming, still-open
 * appointment whose reminder was texted to this exact number.
 *
 * This deliberately doesn't go through users.contactNum or patients.userId.
 * The webhook runs with admin rights, and firestore.rules lets anyone create
 * a users doc and lets a patient rewrite their own patients doc, so those
 * links could be pointed at someone else's record. reminderSentTo is only
 * ever written by the reminder job.
 */
async function findRemindedAppointment(fs: FirestoreAdmin, phone: string, now: Date) {
  // Only appointments that haven't started: an evening reply about
  // tomorrow's appointment must not land on one from earlier today.
  const wallNow = clinicWallClock(now).getTime();
  const appointments = await fs.query("appointments", [
    { field: "reminderSentTo", op: "EQUAL", value: phone },
  ]);
  return (
    appointments
      .filter((a) => typeof a.data.appointDateTime === "string" && new Date(a.data.appointDateTime).getTime() >= wallNow)
      .filter((a) => !["Cancelled", "Completed", "No-Show", "In Progress"].includes(String(a.data.status ?? "")))
      .sort((a, b) => String(a.data.appointDateTime).localeCompare(String(b.data.appointDateTime)))[0] ?? null
  );
}

export async function handleInboundSmsReply(
  payload: { from: string; message: string },
  fs: FirestoreAdmin,
  now = new Date(),
): Promise<{ ok: boolean; patientId?: string; action?: SmsReplyAction; reason?: string }> {
  const message = payload.message.trim();
  const choice = message.startsWith("1") ? "confirm" : message.startsWith("2") ? "decline" : null;

  if (!choice) {
    return { ok: false, reason: "no-confirmation-choice" };
  }

  const from = formatPhoneForSms(payload.from);
  if (!from) {
    return { ok: false, reason: "missing-sender" };
  }

  const appointment = await findRemindedAppointment(fs, from, now);
  if (!appointment) {
    return { ok: false, reason: "no-reminded-appointment" };
  }

  const status = choice === "confirm" ? "Confirmed" : "Cancelled";
  const writes: FirestoreWrite[] = [{ update: ["appointments", appointment.id], data: { status } }];

  const patientId = String(appointment.data.patientId ?? "");
  const patient = patientId ? await fs.get("patients", patientId) : null;
  const userId = Number(patient?.data.userId ?? 0);
  if (userId) {
    const payloadStatus = choice === "confirm" ? "confirmed" : "declined";
    writes.push({
      create: "notifications",
      data: {
        userId,
        title: "Appointment update",
        message: `Your appointment was ${payloadStatus}.`,
        isRead: false,
        timeSent: new Date().toISOString(),
      },
    });
  }
  await fs.commit(writes);

  return { ok: true, patientId, action: choice };
}
