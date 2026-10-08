// Server-only: run by the Worker's cron triggers (src/server/plugins/sms-reminders.ts)
// and by POST /api/sms/reminders.
import { readEnv } from "../server/env";
import { firestoreAdminFromEnv, type FirestoreDoc, type FirestoreWrite } from "../server/firestore-admin";
import { loadAppointmentContexts, reminderText } from "./appointment-sms";
import { clinicWallClock } from "./clinic-time";
import { formatPhoneForSms, sendSms } from "./smsportal";

export type AppointmentReminderKind = "day-before-18:00" | "day-before-20:00" | "morning-08:00";

export interface AppointmentReminderTarget {
  kind: AppointmentReminderKind;
  scheduledFor: Date;
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

/** The reminder slots for an appointment: 18:00 and 20:00 the day before, 08:00 on the day. */
export function getReminderTargetsForAppointment(appointmentDateTime: string): AppointmentReminderTarget[] {
  const start = appointmentDateValue(appointmentDateTime);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  const slots: AppointmentReminderTarget[] = [
    { kind: "day-before-18:00", scheduledFor: new Date(Date.UTC(year, month, day - 1, 18, 0, 0)) },
    { kind: "day-before-20:00", scheduledFor: new Date(Date.UTC(year, month, day - 1, 20, 0, 0)) },
    { kind: "morning-08:00", scheduledFor: new Date(Date.UTC(year, month, day, 8, 0, 0)) },
  ];

  // An appointment at or before 08:00 has already started by the morning
  // slot, so asking the patient to confirm it then makes no sense.
  return slots.filter((slot) => slot.scheduledFor.getTime() < start.getTime());
}

type ReminderResult = { appointmentId: string; kind: AppointmentReminderKind; sent: boolean; reason?: string };

/*
 * Subrequests: Workers Free allows 50 outbound requests per invocation (Paid
 * allows 10,000). A run makes up to 7 fixed requests (token, appointment
 * query, and one batched read each for patients, doctors, nurses, clinics and
 * users) plus 2 per reminder (the SMS, then one commit that logs it and adds
 * the in-app notification), so about 21 reminders fit in one cron run on Free. The job counts its requests and stops
 * before a reminder that couldn't be both sent and logged, reporting the rest
 * as deferred; set WORKER_SUBREQUEST_LIMIT on the Paid plan. Each reminder is
 * handled on its own, so a failure is reported for that appointment and the
 * rest still go out.
 */
export async function processDueAppointmentReminders(
  now = new Date(),
  env?: unknown,
  /**
   * sendNow (testing only, and only while SMS_ONLY_TO is set): ignore the
   * 18:00/20:00/08:00 windows and send each upcoming appointment's next
   * unsent reminder straight away. sendSms still refuses numbers not on
   * SMS_ONLY_TO, so only the tester is texted.
   */
  options: { sendNow?: boolean } = {},
) {
  const fs = firestoreAdminFromEnv(env);
  const subrequestLimit = Number(readEnv(env, "WORKER_SUBREQUEST_LIMIT")) || 50;
  let smsRequests = 0;
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
  const due: Array<{ appointment: FirestoreDoc; target: AppointmentReminderTarget }> = [];
  for (const appointmentDoc of appointments) {
    const appointment = appointmentDoc.data;
    if (!appointment.appointDateTime || typeof appointment.appointDateTime !== "string") continue;
    if (["Cancelled", "Confirmed", "Completed"].includes(String(appointment.status ?? ""))) continue;

    const appointmentDateTime = new Date(appointment.appointDateTime);
    if (Number.isNaN(appointmentDateTime.getTime())) continue;
    if (options.sendNow && appointmentDateTime <= wallNow) continue;

    if (!appointment.patientId) continue;

    const reminderLog: string[] = Array.isArray(appointment.reminderLog) ? (appointment.reminderLog as string[]) : [];
    const targets = getReminderTargetsForAppointment(appointment.appointDateTime);

    for (const target of targets) {
      const isDue =
        options.sendNow || (wallNow >= target.scheduledFor && wallNow <= addMinutes(target.scheduledFor, 30));
      if (!isDue || reminderLog.includes(target.kind)) continue;
      due.push({ appointment: appointmentDoc, target });
      if (options.sendNow) break;
    }
  }
  if (due.length === 0) return results;

  // Patient first names and phones, clinic names and clinician names for
  // every due reminder, in one batched read per collection.
  const contexts = await loadAppointmentContexts(fs, [...new Map(due.map((d) => [d.appointment.id, d.appointment])).values()]);

  for (const { appointment, target } of due) {
    const appointmentId = appointment.id;
    let smsSent = false;
    try {
      const context = contexts.get(appointmentId);
      const phone = context?.phone ?? "";
      if (!context || !phone) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: "missing-phone" });
        continue;
      }

      // Stop before a reminder that couldn't be both sent and logged within
      // the subrequest limit, rather than send one that goes unrecorded.
      if (fs.requestCount + smsRequests + 2 > subrequestLimit) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: "deferred-subrequest-limit" });
        continue;
      }

      const message = reminderText(context);
      const sent = await sendSms({
        to: phone,
        message,
        testMode: false,
        env,
      });
      if (!sent.dryRun && sent.reason !== "missing-phone") smsRequests++;

      if (!sent.ok) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: sent.reason });
        continue;
      }
      // Without SMSPortal credentials nothing was sent, so don't use up the
      // slot or record a number a reply could later match.
      if (sent.dryRun) {
        results.push({ appointmentId, kind: target.kind, sent: false, reason: "dry-run" });
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
      if (context.userId) {
        writes.push({
          create: "notifications",
          data: {
            userId: context.userId,
            title: "Appointment reminder",
            message,
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

  const deferred = results.filter((r) => r.reason === "deferred-subrequest-limit").length;
  if (deferred) {
    console.warn(
      `[sms-reminders] ${deferred} reminder(s) deferred to stay within ${subrequestLimit} subrequests; ` +
        "on the Workers Paid plan set WORKER_SUBREQUEST_LIMIT (e.g. 10000)",
    );
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
