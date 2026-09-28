import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type SmsReplyAction = "confirm" | "decline";

function readEnv(name: string): string | undefined {
  const fromMeta = typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string | boolean | undefined> }).env?.[name] : undefined;
  if (typeof fromMeta === "string") return fromMeta;
  if (typeof fromMeta === "boolean") return String(fromMeta);
  if (typeof process !== "undefined" && process.env) return process.env[name];
  return undefined;
}

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

export async function sendSms({
  to,
  message,
  testMode,
}: {
  to: string;
  message: string;
  testMode?: boolean;
}): Promise<{ ok: boolean; dryRun?: boolean; reason?: string }> {
  const phone = formatPhoneForSms(to);
  if (!phone) return { ok: false, reason: "missing-phone" };

  const clientId = readEnv("SMSPORTAL_CLIENT_ID") ?? "";
  const apiSecret = readEnv("SMSPORTAL_API_SECRET") ?? "";
  const shouldTest = testMode ?? (readEnv("SMSPORTAL_TEST_MODE") === "true");

  if (!clientId || !apiSecret || shouldTest) {
    console.info(`[sms:test] ${phone} :: ${message}`);
    return { ok: true, dryRun: true };
  }

  try {
    const auth = btoa(`${clientId}:${apiSecret}`);
    const res = await fetch("https://api.smsportal.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        to: phone,
        message,
        source: "Zennith",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[sms] send failed:", res.status, text);
      return { ok: false, reason: `sms-provider:${res.status}` };
    }

    return { ok: true };
  } catch (error) {
    console.error("[sms] request error:", error);
    return { ok: false, reason: "sms-error" };
  }
}

async function findPatientByPhone(phone: string): Promise<{ patientId: string; userId?: number } | null> {
  const formatted = formatPhoneForSms(phone);
  const candidates = new Set<string>([
    formatted,
    formatted.replace(/^\+27/, "0"),
    formatted.replace(/^\+/, ""),
    formatted.replace(/^\+27/, "27"),
  ]);

  const snap = await getDocs(query(collection(db, "users"), where("contactNum", "in", [...candidates])));
  if (snap.empty) return null;

  const user = snap.docs[0].data();
  const userId = Number(user.userId ?? snap.docs[0].id);
  const patientSnap = await getDocs(query(collection(db, "patients"), where("userId", "==", userId)));
  if (patientSnap.empty) return null;

  const patient = patientSnap.docs[0].data();
  return {
    patientId: patientSnap.docs[0].id,
    userId: Number(patient.userId ?? userId),
  };
}

async function findNextAppointmentForPatient(patientId: string) {
  const snap = await getDocs(query(collection(db, "appointments"), where("patientId", "==", patientId)));
  if (snap.empty) return null;
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => typeof a.appointDateTime === "string")
    .sort((a, b) => String(a.appointDateTime).localeCompare(String(b.appointDateTime)));

  return items.find((a) => !["Cancelled", "Completed", "Confirmed"].includes(String(a.status ?? ""))) ?? items[0] ?? null;
}

export async function handleInboundSmsReply(payload: {
  from?: string;
  message?: string;
  text?: string;
  body?: string;
}): Promise<{ ok: boolean; patientId?: string; action?: SmsReplyAction; reason?: string }> {
  const phone = payload.from ?? payload.body ?? payload.text ?? "";
  const message = (payload.message ?? payload.text ?? payload.body ?? "").toString().trim();
  const choice = message.startsWith("1") ? "confirm" : message.startsWith("2") ? "decline" : null;

  if (!choice) {
    return { ok: false, reason: "no-confirmation-choice" };
  }

  const patient = await findPatientByPhone(phone);
  if (!patient) {
    return { ok: false, reason: "patient-not-found" };
  }

  const appointment = await findNextAppointmentForPatient(patient.patientId);
  if (!appointment) {
    return { ok: false, reason: "no-upcoming-appointment" };
  }

  const status = choice === "confirm" ? "Confirmed" : "Cancelled";
  await updateDoc(doc(db, "appointments", appointment.id), { status });

  const payloadStatus = choice === "confirm" ? "Confirmed" : "Declined";
  const fallbackUserId = Number(patient.patientId.replace(/\D/g, ""));
  const resolvedUserId = patient.userId ?? fallbackUserId;
  await addDoc(collection(db, "notifications"), {
    userId: resolvedUserId || 0,
    title: "Appointment update",
    message: `Your appointment was ${payloadStatus.toLowerCase()}.`,
    isRead: false,
    timeSent: new Date().toISOString(),
  });

  return { ok: true, patientId: patient.patientId, action: choice };
}
