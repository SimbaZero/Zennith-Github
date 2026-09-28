// Server-only: run by the Worker's cron triggers (src/server/plugins/sms-reminders.ts)
// and by POST /api/sms/reminders.
import { firestoreAdminFromEnv, type FirestoreWrite } from "../server/firestore-admin";
import { clinicWallClock } from "./clinic-time";
import { buildAppointmentReminderText, formatPhoneForSms, sendSms } from "./smsportal";

export type AppointmentReminderKind = "day-before-18:00" | "day-before-20:00" | "morning-08:00";

export interface AppointmentReminderTarget {
  kind: AppointmentReminderKind;
  scheduledFor: Date;
  message: string;
}

// Slot times are built with Date.UTC from the stored appointDateTime and
// compared with clinicWallClock(now); see clinic-time.ts for why.

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

type ReminderResult = { appointmentId: string; kind: AppointmentReminderKind; sent: boolean; reason?: string };

/*
 * Subrequests: Workers Free allows 50 outbound requests per invocation (Paid
 * allows 10,000). A run makes 4 fixed requests (token, appointment query, one
 * batched read each for patients and users) plus 2 per reminder (the SMS, then
 * one commit that logs it and adds the in-app notification), so about 23
 * reminders fit in one cron run on Free. Each reminder is handled on its own,
 * so a failure is reported for that appointment and the rest still go out.
 */
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

  const results: ReminderResult[] = [];

  // Work out every due reminder first, so the patient and user reads below
  // can each be one batched request.
  const due: Array<{ appointmentId: string; patientId: string; target: AppointmentReminderTarget }> = [];
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
      due.push({ appointmentId: appointmentDoc.id, patientId: String(patientId), target });
    }
  }
  if (due.length === 0) return results;

  const patients = await fs.getMany("patients", due.map((d) => d.patientId));
  const userIds = [...patients.values()].flatMap((p) => (p.data.userId == null ? [] : [String(p.data.userId)]));
  const users = await fs.getMany("users", userIds);

  for (const { appointmentId, patientId, target } of due) {
    let smsSent = false;
    try {
      const patient = patients.get(patientId);
      const user = patient?.data.userId == null ? undefined : users.get(String(patient.data.userId));
      const phone = user ? String(user.data.contactNum ?? "") : "";
      if (!phone) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: "missing-phone" });
        continue;
      }

      const sent = await sendSms({
        to: phone,
        message: target.message,
        testMode: false,
        env,
      });

      if (!sent.ok) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: sent.reason });
        continue;
      }
      smsSent = true;

      const writes: FirestoreWrite[] = [
        {
          update: ["appointments", appointmentId],
          // The number this reminder went to. handleInboundSmsReply only
          // applies a reply to an appointment texted to the replying number.
          data: { reminderSentTo: formatPhoneForSms(phone) },
          appendToArrays: { reminderLog: [target.kind] },
        },
      ];
      const userId = Number(patient?.data.userId ?? 0);
      if (userId) {
        writes.push({
          create: "notifications",
          data: {
            userId,
            title: "Appointment reminder",
            message: target.message,
            isRead: false,
            timeSent: new Date().toISOString(),
            source: "sms-reminder",
          },
        });
      }
      await fs.commit(writes);

      results.push({ appointmentId, kind: target.kind, sent: true });
    } catch (error) {
      console.error(`[sms-reminders] ${target.kind} for appointment ${appointmentId} failed:`, error);
      // If the SMS went out but logging it failed, say so: the patient has the
      // text, but the next run in this slot would send it again.
      results.push(
        smsSent
          ? { appointmentId, kind: target.kind, sent: true, reason: "sent-but-not-logged" }
          : { appointmentId, kind: target.kind, sent: false, reason: "error" },
      );
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
