// Server-only: the text a patient gets when an appointment is booked for
// them. Called through the server function in src/lib/booking-sms.ts right
// after the browser has created the appointment.
//
// The browser writes appointments itself (firestore.rules let staff create
// them), so this acts only on what is already stored and takes nothing from
// the request but the appointment's ID. Each appointment is texted at most
// once, only in the minutes after it was created, and texts to one patient
// are capped per day, so neither repeated calls nor old appointment IDs can
// be used to send texts.
//
// State:
//   appointments/{id}.bookingSms            "sending", then "sent", "failed",
//                                           "test-mode" or "daily-limit"
//   smsBookingLimits/{patientId}_{day}      booking texts per patient, per UTC
//                                           day (firestore.rules deny clients)
import { getReminderTargetsForAppointment } from "../lib/appointment-reminders";
import { bookedText, isDocumentId, loadAppointmentContexts } from "../lib/appointment-sms";
import { clinicWallClock } from "../lib/clinic-time";
import { formatPhoneForSms, isSmsConfigured, isSmsTestMode, sendSms } from "../lib/smsportal";
import type { BookingSmsResult } from "../lib/booking-sms";
import { verifyIdToken } from "./firebase-auth";
import { FirestoreConfigError, firestoreAdminFromEnv, type FirestoreAdmin, WriteConflict } from "./firestore-admin";

// The roles firestore.rules allow to create appointments.
const BOOKING_ROLES = new Set(["doctor", "nurse", "pharmacist", "receptionist", "admin", "super_admin"]);
// The browser asks within seconds of booking; anything older isn't a new booking.
const NEW_BOOKING_MS = 10 * 60_000;
// Several bookings in a day are normal; this only stops a stream of texts to one patient.
const MAX_TEXTS_PER_PATIENT_PER_DAY = 5;
// appointments docs are keyed by the numeric appointment ID.
const APPOINTMENT_ID = /^\d{1,20}$/;

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

export async function sendBookingSms(idToken: unknown, appointmentId: unknown, env?: unknown): Promise<BookingSmsResult> {
  const fs = adminOrNull(env);
  if (!fs || (!isSmsConfigured(env) && !isSmsTestMode(env))) return { sent: false, reason: "not-configured" };

  const uid = await verifyIdToken(idToken, fs.projectId);
  if (!uid) return { sent: false, reason: "unauthenticated" };

  const id = String(appointmentId ?? "");
  if (!APPOINTMENT_ID.test(id)) return { sent: false, reason: "not-found" };

  const [profile, appointment] = await Promise.all([fs.get("profiles", uid), fs.get("appointments", id)]);
  if (!BOOKING_ROLES.has(String(profile?.data.role ?? ""))) return { sent: false, reason: "not-allowed" };
  if (!appointment?.updateTime) return { sent: false, reason: "not-found" };

  const a = appointment.data;
  if (a.bookingSms != null) return { sent: false, reason: "already-sent" };
  const now = new Date();
  const createdAt = Date.parse(appointment.createTime ?? "");
  const startsAt = new Date(String(a.appointDateTime ?? ""));
  const wallNow = clinicWallClock(now);
  if (
    a.status !== "Scheduled" ||
    !(now.getTime() - createdAt < NEW_BOOKING_MS) ||
    Number.isNaN(startsAt.getTime()) ||
    startsAt <= wallNow
  ) {
    return { sent: false, reason: "not-eligible" };
  }

  const patientId = String(a.patientId ?? "");
  const context = isDocumentId(patientId) ? (await loadAppointmentContexts(fs, [appointment])).get(id) : undefined;
  const phone = formatPhoneForSms(context?.phone);
  if (!context || !phone) return { sent: false, reason: "no-phone" };

  // Claim the appointment, pinned to the version read so only one call can,
  // and count the text against the patient's day in the same commit.
  const day = now.toISOString().slice(0, 10);
  const counter: [string, string] = ["smsBookingLimits", `${patientId}_${day}`];
  let count: number;
  try {
    const results = await fs.commit([
      {
        update: ["appointments", id],
        data: { bookingSms: "sending", bookingSmsAt: now.toISOString() },
        precondition: { updateTime: appointment.updateTime },
      },
      { increment: counter, by: { sends: 1 } },
    ]);
    count = Number(results[1]?.transformResults[0]);
  } catch (error) {
    if (error instanceof WriteConflict) return { sent: false, reason: "busy" };
    throw error;
  }

  const finish = async (bookingSms: string, giveBack: boolean) => {
    await fs.commit([
      { update: ["appointments", id], data: { bookingSms } },
      ...(giveBack ? [{ increment: counter, by: { sends: -1 } }] : []),
    ]).catch((error) => console.error(`[booking-sms] appointment ${id}: couldn't record "${bookingSms}":`, error));
  };

  // Fails closed if the count is missing.
  if (!(count <= MAX_TEXTS_PER_PATIENT_PER_DAY)) {
    console.warn(`[booking-sms] appointment ${id}: patient's daily limit of booking texts reached`);
    await finish("daily-limit", true);
    return { sent: false, reason: "rate-limited" };
  }

  // Mention the reminder only if one is still to come: the reminder job sends
  // each one at its slot time, so a slot already past won't be sent.
  const reminderToCome = getReminderTargetsForAppointment(String(a.appointDateTime)).some((t) => t.scheduledFor > wallNow);
  const sent = await sendSms({ to: phone, message: bookedText(context, reminderToCome), env });
  if (!sent.ok) {
    console.error(`[booking-sms] appointment ${id}: text not sent: ${sent.reason}`);
    // Failed texts aren't billed, so they don't count against the patient's day.
    await finish("failed", true);
    return { sent: false, reason: "send-failed" };
  }
  await finish(sent.dryRun ? "test-mode" : "sent", false);
  return { sent: true };
}
