// Server-only: the text a patient gets when an appointment is booked for
// them. Called through the server function in src/lib/booking-sms.ts right
// after the browser has created the appointment.
//
// The browser writes appointments itself (firestore.rules let staff create
// them), so this acts only on what is already stored and takes nothing from
// the request but the appointment's ID. Each appointment is texted at most
// once, only in the minutes after it was created, and only to a South
// African mobile number.
//
// Patients and their phone numbers are records anyone can create (see
// firestore.rules), so texts are also capped per day: per patient, per phone
// number, per booking account and app-wide. Without that, one staff account
// could book appointment after appointment for made-up patients and send
// texts without limit.
//
// State:
//   appointments/{id}.bookingSms   "sending", then "sent", "failed",
//                                  "test-mode" or "daily-limit"
//   smsBookingLimits/{key}         booking texts per UTC day, keyed
//                                  "patient:{id}:{day}", "phone:{number}:{day}",
//                                  "caller:{uid}:{day}" and "all:{day}"
//                                  (firestore.rules deny clients)
import { getReminderTargetsForAppointment } from "../lib/appointment-reminders";
import { bookedText, isDocumentId, loadAppointmentContexts } from "../lib/appointment-sms";
import { clinicWallClock } from "../lib/clinic-time";
import { formatPhoneForSms, isSmsConfigured, isSmsTestMode, sendSms, toSouthAfricanMobile } from "../lib/smsportal";
import type { BookingSmsResult } from "../lib/booking-sms";
import { readEnv } from "./env";
import { verifyIdToken } from "./firebase-auth";
import { FirestoreConfigError, firestoreAdminFromEnv, type FirestoreAdmin, type FirestoreWrite, WriteConflict } from "./firestore-admin";

// The roles firestore.rules allow to create appointments.
const BOOKING_ROLES = new Set(["doctor", "nurse", "pharmacist", "receptionist", "admin", "super_admin"]);
// The browser asks within seconds of booking; anything older isn't a new booking.
const NEW_BOOKING_MS = 10 * 60_000;
// Several bookings in a day are normal for one patient or one phone; these
// stop a stream of texts to one person.
const MAX_TEXTS_PER_PATIENT_PER_DAY = 5;
const MAX_TEXTS_PER_PHONE_PER_DAY = 5;
// Well above what one receptionist books in a day.
const MAX_TEXTS_PER_CALLER_PER_DAY = 200;
const DEFAULT_TEXTS_PER_DAY = 500;
// appointments docs are keyed by the numeric appointment ID.
const APPOINTMENT_ID = /^\d{1,20}$/;

/** SMS_BOOKING_DAILY_LIMIT as a whole number (0 = no booking texts), else the default. */
function appDailyLimit(env: unknown): number {
  const raw = readEnv(env, "SMS_BOOKING_DAILY_LIMIT")?.trim();
  if (raw == null || raw === "") return DEFAULT_TEXTS_PER_DAY;
  if (/^\d+$/.test(raw)) return Number(raw);
  console.warn(`[booking-sms] SMS_BOOKING_DAILY_LIMIT "${raw}" isn't a whole number; using ${DEFAULT_TEXTS_PER_DAY}`);
  return DEFAULT_TEXTS_PER_DAY;
}

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
  const role = profile?.data.role;
  if (typeof role !== "string" || !BOOKING_ROLES.has(role)) return { sent: false, reason: "not-allowed" };
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
  // Only South African mobiles: never a landline, a premium or toll-free
  // number, a short code or a foreign number someone typed into a record.
  // Read the way reminders read it, so "Cell: 082 123 4567" counts too.
  const phone = toSouthAfricanMobile(formatPhoneForSms(context?.phone));
  if (!context || !phone) return { sent: false, reason: "no-phone" };

  // Claim the appointment, pinned to the version read so only one call can,
  // and count the text against each daily cap in the same commit.
  const day = now.toISOString().slice(0, 10);
  const caps: Array<{ name: string; key: string; max: number }> = [
    { name: "patient", key: `patient:${patientId}:${day}`, max: MAX_TEXTS_PER_PATIENT_PER_DAY },
    { name: "phone number", key: `phone:${phone.slice(1)}:${day}`, max: MAX_TEXTS_PER_PHONE_PER_DAY },
    { name: "booking account", key: `caller:${uid}:${day}`, max: MAX_TEXTS_PER_CALLER_PER_DAY },
    { name: "app-wide", key: `all:${day}`, max: appDailyLimit(env) },
  ];
  const counts = (by: number): FirestoreWrite[] =>
    caps.map(({ key }) => ({ increment: ["smsBookingLimits", key], by: { sends: by } }));
  let over: (typeof caps)[number] | undefined;
  try {
    const results = await fs.commit([
      {
        update: ["appointments", id],
        data: { bookingSms: "sending", bookingSmsAt: now.toISOString() },
        precondition: { updateTime: appointment.updateTime },
      },
      ...counts(1),
    ]);
    // Fails closed if a count is missing.
    over = caps.find((cap, i) => !(Number(results[i + 1]?.transformResults[0]) <= cap.max));
  } catch (error) {
    if (error instanceof WriteConflict) return { sent: false, reason: "busy" };
    throw error;
  }

  const finish = async (bookingSms: string, giveBack: boolean) => {
    await fs
      .commit([{ update: ["appointments", id], data: { bookingSms } }, ...(giveBack ? counts(-1) : [])])
      .catch((error) => console.error(`[booking-sms] appointment ${id}: couldn't record "${bookingSms}":`, error));
  };

  if (over) {
    console.warn(`[booking-sms] appointment ${id}: ${over.name} daily limit of booking texts reached`);
    await finish("daily-limit", true);
    return { sent: false, reason: "rate-limited" };
  }

  // Mention the reminder only if one is still to come: the reminder job sends
  // each one at its slot time, so a slot already past won't be sent.
  const reminderToCome = getReminderTargetsForAppointment(String(a.appointDateTime)).some((t) => t.scheduledFor > wallNow);
  const sent = await sendSms({ to: phone, message: bookedText(context, reminderToCome), env });
  if (!sent.ok) {
    console.error(`[booking-sms] appointment ${id}: text not sent: ${sent.reason}`);
    // Give the slots back so an SMSPortal outage doesn't use up anyone's day.
    // Rarely a network error or 5xx comes after SMSPortal took the message;
    // that text then goes uncounted, which callers can't cause.
    await finish("failed", true);
    return { sent: false, reason: "send-failed" };
  }
  await finish(sent.dryRun ? "test-mode" : "sent", false);
  return { sent: true };
}
