// Server-only: runs in the Worker (reminder cron, reply webhook), never in
// the browser. Firestore access goes through the service-account REST client
// because there is no signed-in user here.
import { readEnv } from "../server/env";
import type { FirestoreAdmin } from "../server/firestore-admin";

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
  env,
}: {
  to: string;
  message: string;
  testMode?: boolean;
  env?: unknown;
}): Promise<{ ok: boolean; dryRun?: boolean; reason?: string }> {
  const phone = formatPhoneForSms(to);
  if (!phone) return { ok: false, reason: "missing-phone" };

  const clientId = readEnv(env, "SMSPORTAL_CLIENT_ID") ?? "";
  const apiSecret = readEnv(env, "SMSPORTAL_API_SECRET") ?? "";
  const shouldTest = testMode ?? (readEnv(env, "SMSPORTAL_TEST_MODE") === "true");

  if (!clientId || !apiSecret || shouldTest) {
    console.info(`[sms:test] ${phone} :: ${message}`);
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

  if (request.method === "POST") {
    const raw = await request.text().catch(() => "");
    const contentType = request.headers.get("content-type") ?? "";
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

async function findPatientByPhone(
  fs: FirestoreAdmin,
  phone: string,
): Promise<{ patientId: string; userId?: number } | null> {
  const formatted = formatPhoneForSms(phone);
  const candidates = new Set<string>([
    formatted,
    formatted.replace(/^\+27/, "0"),
    formatted.replace(/^\+/, ""),
    formatted.replace(/^\+27/, "27"),
  ]);

  const users = await fs.query("users", [{ field: "contactNum", op: "IN", value: [...candidates] }]);
  if (users.length === 0) return null;

  const user = users[0].data;
  const userId = Number(user.userId ?? users[0].id);
  const patients = await fs.query("patients", [{ field: "userId", op: "EQUAL", value: userId }]);
  if (patients.length === 0) return null;

  const patient = patients[0].data;
  return {
    patientId: patients[0].id,
    userId: Number(patient.userId ?? userId),
  };
}

async function findNextAppointmentForPatient(fs: FirestoreAdmin, patientId: string) {
  const appointments = await fs.query("appointments", [
    { field: "patientId", op: "EQUAL", value: patientId },
  ]);
  const items = appointments
    .filter((a) => typeof a.data.appointDateTime === "string")
    .sort((a, b) => String(a.data.appointDateTime).localeCompare(String(b.data.appointDateTime)));

  return (
    items.find((a) => !["Cancelled", "Completed", "Confirmed"].includes(String(a.data.status ?? ""))) ??
    items[0] ??
    null
  );
}

export async function handleInboundSmsReply(
  payload: { from: string; message: string },
  fs: FirestoreAdmin,
): Promise<{ ok: boolean; patientId?: string; action?: SmsReplyAction; reason?: string }> {
  const message = payload.message.trim();
  const choice = message.startsWith("1") ? "confirm" : message.startsWith("2") ? "decline" : null;

  if (!choice) {
    return { ok: false, reason: "no-confirmation-choice" };
  }

  const patient = await findPatientByPhone(fs, payload.from);
  if (!patient) {
    return { ok: false, reason: "patient-not-found" };
  }

  const appointment = await findNextAppointmentForPatient(fs, patient.patientId);
  if (!appointment) {
    return { ok: false, reason: "no-upcoming-appointment" };
  }

  const status = choice === "confirm" ? "Confirmed" : "Cancelled";
  await fs.update("appointments", appointment.id, { status });

  const payloadStatus = choice === "confirm" ? "Confirmed" : "Declined";
  const fallbackUserId = Number(patient.patientId.replace(/\D/g, ""));
  const resolvedUserId = patient.userId ?? fallbackUserId;
  await fs.add("notifications", {
    userId: resolvedUserId || 0,
    title: "Appointment update",
    message: `Your appointment was ${payloadStatus.toLowerCase()}.`,
    isRead: false,
    timeSent: new Date().toISOString(),
  });

  return { ok: true, patientId: patient.patientId, action: choice };
}
