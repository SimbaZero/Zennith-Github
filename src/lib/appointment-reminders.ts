// Server-only: run by the Worker's cron triggers (src/server/plugins/sms-reminders.ts)
// and by POST /api/sms/reminders.
import { firestoreAdminFromEnv, type FirestoreAdmin } from "../server/firestore-admin";
import { buildAppointmentReminderText, formatPhoneForSms, sendSms } from "./smsportal";

export type AppointmentReminderKind = "day-before-18:00" | "day-before-20:00" | "morning-08:00";

export interface AppointmentReminderTarget {
  kind: AppointmentReminderKind;
  scheduledFor: Date;
  message: string;
}

/*
 * Time zones: clinic-data.ts stores appointDateTime as the clinic's wall-clock
 * time with a "Z" suffix (`${date}T${time}:00.000Z`), so a 10:00 SAST
 * appointment is stored as 10:00Z. All reminder maths stays in that frame:
 * slot times are built with Date.UTC from the stored value, and "now" is
 * converted to the clinic's wall-clock time before comparing. Comparing with
 * the real UTC clock instead puts every slot two hours late.
 */
export const CLINIC_TIME_ZONE = "Africa/Johannesburg";

/** The clinic's current wall-clock time, in the same "local time labelled Z" frame as appointDateTime. */
export function clinicWallClock(now: Date, timeZone = CLINIC_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(
    Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")),
  );
}

function appointmentDateValue(appointmentDateTime: string): Date {
  const value = new Date(appointmentDateTime);
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function getReminderTargetsForAppointment(
  appointmentDateTime: string,
  clinician = "your clinic team",
): AppointmentReminderTarget[] {
  const start = appointmentDateValue(appointmentDateTime);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  const slots: Array<{ kind: AppointmentReminderKind; at: Date }> = [
    { kind: "day-before-18:00", at: new Date(Date.UTC(year, month, day - 1, 18, 0, 0)) },
    { kind: "day-before-20:00", at: new Date(Date.UTC(year, month, day - 1, 20, 0, 0)) },
    { kind: "morning-08:00", at: new Date(Date.UTC(year, month, day, 8, 0, 0)) },
  ];

  const date = start.toISOString().slice(0, 10);
  const time = start.toISOString().slice(11, 16);

  return slots.map((slot) => ({
    kind: slot.kind,
    scheduledFor: slot.at,
    message: buildAppointmentReminderText({
      appointmentDate: date,
      appointmentTime: time,
      clinician,
      isMorningReply: slot.kind === "morning-08:00",
    }),
  }));
}

async function getPatientContact(
  fs: FirestoreAdmin,
  patientId: string,
): Promise<{ phone: string | null; userId: number }> {
  const patient = await fs.get("patients", patientId);
  const userId = Number(patient?.data.userId ?? 0);
  if (!patient || patient.data.userId == null) return { phone: null, userId };
  const user = await fs.get("users", String(patient.data.userId));
  return { phone: user ? String(user.data.contactNum ?? "") : null, userId };
}

export async function processDueAppointmentReminders(now = new Date(), env?: unknown) {
  const fs = firestoreAdminFromEnv(env);
  const wallNow = clinicWallClock(now);

  // A reminder can only be due for today's appointments (morning slot) or
  // tomorrow's (day-before slots), so only those are read. appointDateTime is
  // an ISO string, so a string range selects whole days.
  const today = wallNow.toISOString().slice(0, 10);
  const dayAfterTomorrow = new Date(
    Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth(), wallNow.getUTCDate() + 2),
  )
    .toISOString()
    .slice(0, 10);
  const appointments = await fs.query("appointments", [
    { field: "appointDateTime", op: "GREATER_THAN_OR_EQUAL", value: today },
    { field: "appointDateTime", op: "LESS_THAN", value: dayAfterTomorrow },
  ]);

  const results: Array<{ appointmentId: string; kind: AppointmentReminderKind; sent: boolean; reason?: string }> = [];

  for (const appointmentDoc of appointments) {
    const appointment = appointmentDoc.data;
    if (!appointment.appointDateTime || typeof appointment.appointDateTime !== "string") continue;
    if (["Cancelled", "Confirmed", "Completed"].includes(String(appointment.status ?? ""))) continue;

    const appointmentDateTime = new Date(appointment.appointDateTime);
    if (Number.isNaN(appointmentDateTime.getTime())) continue;

    const patientId = appointment.patientId;
    if (!patientId) continue;

    const reminderLog: string[] = Array.isArray(appointment.reminderLog) ? (appointment.reminderLog as string[]) : [];
    const clinician = String(appointment.clinician ?? "your clinic team");
    const targets = getReminderTargetsForAppointment(appointment.appointDateTime, clinician);

    for (const target of targets) {
      const isDue = wallNow >= target.scheduledFor && wallNow <= addMinutes(target.scheduledFor, 30);
      if (!isDue || reminderLog.includes(target.kind)) continue;

      const contact = await getPatientContact(fs, String(patientId));
      if (!contact.phone) {
        results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: false, reason: "missing-phone" });
        continue;
      }

      const sent = await sendSms({
        to: contact.phone,
        message: target.message,
        testMode: false,
        env,
      });

      if (!sent.ok) {
        results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: false, reason: sent.reason });
        continue;
      }

      if (contact.userId) {
        await fs.add("notifications", {
          userId: contact.userId,
          title: "Appointment reminder",
          message: target.message,
          isRead: false,
          timeSent: new Date().toISOString(),
          source: "sms-reminder",
        });
      }

      reminderLog.push(target.kind);
      await fs.update("appointments", appointmentDoc.id, {
        reminderLog: Array.from(new Set(reminderLog)),
      });

      results.push({ appointmentId: appointmentDoc.id, kind: target.kind, sent: true });
    }
  }

  return results;
}

export function appointmentReminderTypesForDate(date: string, time: string): AppointmentReminderKind[] {
  const appointmentDate = new Date(`${date}T${time}:00`);
  const dayBefore = new Date(appointmentDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const morning = new Date(appointmentDate);
  morning.setHours(8, 0, 0, 0);

  const byDate = [
    { type: "day-before-18:00" as const, at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 18, 0, 0) },
    { type: "day-before-20:00" as const, at: new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate(), 20, 0, 0) },
    { type: "morning-08:00" as const, at: new Date(morning) },
  ];

  return byDate.map((slot) => slot.type);
}

export function getPatientPhoneCandidates(value: string): string[] {
  const normalized = formatPhoneForSms(value);
  if (!normalized) return [];
  return [normalized, normalized.replace(/^\+27/, "0"), normalized.replace(/^\+/, "")];
}
