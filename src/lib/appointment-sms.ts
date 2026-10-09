// Server-only: what the appointment texts say, and the names they need.
//
// Names are read in batches (one request per collection) so a cron run stays
// within the Worker's subrequest limit however many reminders are due.
import type { FirestoreAdmin, FirestoreDoc } from "../server/firestore-admin";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

// users docs are keyed by the numeric legacy user ID. patients.userId is
// patient-editable (see firestore.rules), so anything else is ignored rather
// than allowed to fail the batched read for everyone.
const USER_ID = /^\d{1,20}$/;

/** Whether a string can be used as a Firestore document ID. */
export function isDocumentId(id: string): boolean {
  return id.length > 0 && id.length <= 1500 && !id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

/**
 * "Wed 7 Oct at 10:00". Dates here are the clinic's wall-clock time labelled
 * Z (see clinic-time.ts), so the UTC fields are the clinic's local time.
 */
export function formatAppointmentWhen(at: Date): string {
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} at ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/** "20:00 today", "08:00 tomorrow", or a full date, relative to the clinic's wall clock. */
export function formatNextReminder(at: Date, wallNow: Date): string {
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((dayOf(at) - dayOf(wallNow)) / 86_400_000);
  if (days === 0) return `${time} today`;
  if (days === 1) return `${time} tomorrow`;
  return formatAppointmentWhen(at);
}

export interface AppointmentContext {
  /** The patient's first name, for the greeting. */
  firstName: string | null;
  /** The patient's phone as stored on their users record. */
  phone: string | null;
  /** The patient's numeric user ID, for in-app notifications. */
  userId: number | null;
  clinicName: string | null;
  /** "Dr. Sarah Mokoena", or a nurse's name. */
  clinicianName: string | null;
  /** "Wed 7 Oct at 10:00". */
  when: string;
}

export function reminderText(c: AppointmentContext): string {
  return [
    `Hello ${c.firstName ?? "Patient"},`,
    `Please confirm your appointment at ${c.clinicName ?? "your clinic"} with ${c.clinicianName ?? "your clinician"} on ${c.when}`,
    "Reply 1: Yes",
    "2: No",
  ].join("\n");
}

/** Sent when the appointment is booked. The last line is left out if no reminder is still to come. */
export function bookedText(c: AppointmentContext, reminderToCome: boolean): string {
  return [
    `Hello ${c.firstName ?? "Patient"},`,
    `Your appointment at ${c.clinicName ?? "your clinic"} with ${c.clinicianName ?? "your clinician"} on ${c.when} is booked.`,
    ...(reminderToCome ? ["We'll send you a reminder before your appointment."] : []),
  ].join("\n");
}

export function confirmedText(c: AppointmentContext): string {
  return `Thank you. Your appointment at ${c.clinicName ?? "your clinic"} with ${c.clinicianName ?? "your clinician"} on ${c.when} is confirmed.`;
}

export function remindAgainText(nextReminder: string): string {
  return `Thank you for letting us know. We'll remind you again at ${nextReminder}.`;
}

export function cancelledText(c: AppointmentContext): string {
  return `Thank you for letting us know. Your appointment has been cancelled. Please contact ${c.clinicName ?? "the clinic"} to rebook.`;
}

/**
 * Looks up everything the texts need for these appointments: the patient's
 * first name, phone and user ID, the clinic name, and the clinician's name.
 * One batched read per collection.
 */
export async function loadAppointmentContexts(
  fs: FirestoreAdmin,
  appointments: FirestoreDoc[],
): Promise<Map<string, AppointmentContext>> {
  const str = (v: unknown) => (v == null ? "" : String(v));

  const patientIds = appointments.map((a) => str(a.data.patientId)).filter(isDocumentId);
  const clinicianIds = appointments.map((a) => str(a.data.clinician)).filter(isDocumentId);
  const clinicIds = appointments.map((a) => str(a.data.clinicId)).filter(isDocumentId);

  const [patients, doctors, nurses, clinics] = await Promise.all([
    fs.getMany("patients", patientIds),
    fs.getMany("doctors", clinicianIds.filter((id) => !id.startsWith("Nur"))),
    fs.getMany("nurses", clinicianIds.filter((id) => id.startsWith("Nur"))),
    fs.getMany("clinics", clinicIds),
  ]);

  const userIdOf = (doc: FirestoreDoc | undefined) => {
    const id = str(doc?.data.userId);
    return USER_ID.test(id) ? id : null;
  };
  const clinicianDoc = (id: string) => (id.startsWith("Nur") ? nurses.get(id) : doctors.get(id));

  const userIds = [
    ...[...patients.values()].map(userIdOf),
    ...[...doctors.values(), ...nurses.values()].map(userIdOf),
  ].filter((id): id is string => id !== null);
  const users = await fs.getMany("users", userIds);

  const contexts = new Map<string, AppointmentContext>();
  for (const a of appointments) {
    const patientUserId = userIdOf(patients.get(str(a.data.patientId)));
    const patientUser = patientUserId ? users.get(patientUserId) : undefined;

    const clinicianId = str(a.data.clinician);
    const clinicianUserId = userIdOf(clinicianDoc(clinicianId));
    const clinicianUser = clinicianUserId ? users.get(clinicianUserId) : undefined;
    const clinicianFull = [clinicianUser?.data.names, clinicianUser?.data.surname].filter(Boolean).join(" ").trim();

    const firstName = str(patientUser?.data.names).trim().split(/\s+/)[0] || null;
    const appointDateTime = new Date(str(a.data.appointDateTime));

    contexts.set(a.id, {
      firstName,
      phone: patientUser ? str(patientUser.data.contactNum) || null : null,
      userId: patientUserId ? Number(patientUserId) : null,
      clinicName: str(clinics.get(str(a.data.clinicId))?.data.clinicName) || null,
      // Same convention as the app's clinicianNames(): "Dr." for doctors.
      clinicianName: clinicianFull ? (clinicianId.startsWith("Nur") ? clinicianFull : `Dr. ${clinicianFull}`) : null,
      when: Number.isNaN(appointDateTime.getTime()) ? "" : formatAppointmentWhen(appointDateTime),
    });
  }
  return contexts;
}
