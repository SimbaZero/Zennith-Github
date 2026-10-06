// Server-only: what happens when a patient answers a reminder text.
//
//   1 / yes  The appointment is Confirmed and the patient is texted a
//            confirmation.
//   2 / no   If a later reminder is still to come, the appointment stays
//            Scheduled (the "no" is recorded on it) and the patient is told
//            when they'll be reminded again. A "no" to the last reminder
//            cancels the appointment.
//
// The patient gets the same message as an in-app notification.
import type { FirestoreAdmin, FirestoreDoc, FirestoreWrite } from "../server/firestore-admin";
import { getReminderTargetsForAppointment } from "./appointment-reminders";
import {
  cancelledText,
  confirmedText,
  formatNextReminder,
  loadAppointmentContexts,
  remindAgainText,
} from "./appointment-sms";
import { clinicWallClock } from "./clinic-time";
import { formatPhoneForSms, sendSms } from "./smsportal";

export type SmsReplyAction = "confirm" | "decline";

export type SmsReplyResult =
  | { ok: true; patientId: string; action: SmsReplyAction; cancelled?: boolean }
  | { ok: false; reason: string };

/**
 * "1"/"yes"/"y" or "2"/"no"/"n" as the first word of the reply. Anything else
 * ("2moro is fine", "10 min late") is ignored rather than guessed at.
 */
export function readReplyChoice(message: string): SmsReplyAction | null {
  const first = message.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0];
  if (["1", "yes", "y"].includes(first)) return "confirm";
  if (["2", "no", "n"].includes(first)) return "decline";
  return null;
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
async function findRemindedAppointment(fs: FirestoreAdmin, phone: string, wallNow: Date): Promise<FirestoreDoc | null> {
  // Only appointments that haven't started: an evening reply about
  // tomorrow's appointment must not land on one from earlier today.
  const appointments = await fs.query("appointments", [{ field: "reminderSentTo", op: "EQUAL", value: phone }]);
  return (
    appointments
      .filter((a) => typeof a.data.appointDateTime === "string" && new Date(a.data.appointDateTime) >= wallNow)
      .filter((a) => !["Cancelled", "Completed", "No-Show", "In Progress"].includes(String(a.data.status ?? "")))
      .sort((a, b) => String(a.data.appointDateTime).localeCompare(String(b.data.appointDateTime)))[0] ?? null
  );
}

export async function handleInboundSmsReply(
  payload: { from: string; message: string },
  fs: FirestoreAdmin,
  env?: unknown,
  now = new Date(),
): Promise<SmsReplyResult> {
  const choice = readReplyChoice(payload.message);
  if (!choice) return { ok: false, reason: "no-confirmation-choice" };

  const from = formatPhoneForSms(payload.from);
  if (!from) return { ok: false, reason: "missing-sender" };

  const wallNow = clinicWallClock(now);
  const appointment = await findRemindedAppointment(fs, from, wallNow);
  if (!appointment) return { ok: false, reason: "no-reminded-appointment" };

  const context = (await loadAppointmentContexts(fs, [appointment])).get(appointment.id);
  const patientId = String(appointment.data.patientId ?? "");
  const repliedAt = new Date().toISOString();

  let status: string;
  let reply: string;
  let cancelled = false;
  if (choice === "confirm") {
    status = "Confirmed";
    reply = context ? confirmedText(context) : "Thank you. Your appointment is confirmed.";
  } else {
    // "No" keeps the appointment open while another reminder is still to
    // come, so the patient can confirm later; a "no" to the last one cancels.
    const reminderLog = Array.isArray(appointment.data.reminderLog) ? (appointment.data.reminderLog as string[]) : [];
    const next = getReminderTargetsForAppointment(String(appointment.data.appointDateTime)).find(
      (t) => t.scheduledFor > wallNow && !reminderLog.includes(t.kind),
    );
    if (next) {
      status = "Scheduled";
      reply = remindAgainText(formatNextReminder(next.scheduledFor, wallNow));
    } else {
      status = "Cancelled";
      cancelled = true;
      reply = context ? cancelledText(context) : "Thank you for letting us know. Your appointment has been cancelled.";
    }
  }

  const unchanged = appointment.data.status === status && choice === "confirm";
  const writes: FirestoreWrite[] = [
    {
      update: ["appointments", appointment.id],
      // lastReply/lastReplyAt let staff see the patient's latest answer.
      data: { status, lastReply: choice === "confirm" ? "yes" : "no", lastReplyAt: repliedAt },
    },
  ];
  if (context?.userId && !unchanged) {
    writes.push({
      create: "notifications",
      data: {
        userId: context.userId,
        title: "Appointment update",
        message: reply,
        isRead: false,
        timeSent: repliedAt,
        source: "sms-reply",
      },
    });
  }
  await fs.commit(writes);

  // Answer the text. A repeated "1" for an already-confirmed appointment
  // isn't answered again, so a patient can't trigger a stream of texts.
  if (!unchanged) {
    const sent = await sendSms({ to: from, message: reply, env });
    if (!sent.ok) console.error(`[sms-reply] confirmation text for appointment ${appointment.id} not sent: ${sent.reason}`);
  }

  return { ok: true, patientId, action: choice, ...(cancelled ? { cancelled } : {}) };
}
