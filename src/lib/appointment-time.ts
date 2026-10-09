import { clinicWallClock } from "@/lib/clinic-time";

// How a patient's pages show an appointment's time.
//
// createAppointment stores the clinic's WALL-CLOCK time with a "Z" on the end:
// a 10:00 appointment is "2026-10-12T10:00:00.000Z" even though 10:00 was local
// time, not UTC (see clinic-time.ts). The doctor and nurse pages read it by
// slicing the string. The patient pages used to run it through
// toLocaleTimeString, which believes the Z, converts to the DEVICE's timezone and
// shows 12:00 in South Africa — or 03:00 on a phone set to Los Angeles.
//
// Everything here reads the stored value as the wall-clock time it really is,
// so it comes out the same on any device. It only changes how an existing value
// is DISPLAYED; nothing about how appointments are stored changes.

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "10:00" — read straight off the stored string, so no timezone can touch it. */
export function appointmentTime(iso: string): string {
  return WALL_CLOCK.test(iso) ? iso.slice(11, 16) : "";
}

/**
 * The appointment's date, e.g. "12 Oct 2026". Formatted as UTC because the
 * stored value's UTC fields ARE the clinic's wall-clock fields — formatting in
 * the device's timezone could push a late-evening appointment onto the wrong day.
 */
export function appointmentDateLabel(
  iso: string,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { ...options, timeZone: "UTC" });
}

/** "Mon, 12 Oct, 10:00" */
export function appointmentDateTimeLabel(iso: string): string {
  const date = appointmentDateLabel(iso, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = appointmentTime(iso);
  return date && time ? `${date}, ${time}` : date || time;
}

// "Now" for comparing against a stored appointment has to be in the same frame
// — the clinic's wall clock, labelled Z — not the real UTC clock. Comparing
// against the real clock left an appointment listed as upcoming for two hours
// after it had started. clinicWallClock does that conversion from any device.

/** Has the appointment's time already gone by (by the clinic's clock)? */
export function hasAppointmentPassed(iso: string, now = new Date()): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < clinicWallClock(now).getTime();
}

/** Is it still to come? A missing or unreadable time is neither past nor upcoming. */
export function isUpcomingAppointment(iso: string, now = new Date()): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= clinicWallClock(now).getTime();
}

// ---- soft-locking an appointment's outcome until its time --------------------

/**
 * The statuses that record how a visit WENT. Marking an appointment Complete,
 * No-show or Incomplete before its time has come is recording an outcome that
 * can't have happened yet - usually a mis-click on the wrong day. "In-progress"
 * is deliberately not here: a patient who arrives early is seen early.
 */
export const OUTCOME_STATUSES: readonly string[] = [
  "Complete",
  "No-show",
  "Incomplete",
];

/** An appointment given as the clinic lists it: a date and an "HH:mm" time. */
export function appointmentStart(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

/**
 * Is it too early to record an outcome for an appointment at this date/time?
 * True only while the appointment is still to come; an unreadable time is not
 * locked, so bad data never stops a clinician doing their job.
 */
export function isOutcomeLocked(
  date: string,
  time: string,
  now = new Date(),
): boolean {
  return isUpcomingAppointmentStrict(appointmentStart(date, time), now);
}

/** Does the appointment start strictly after the clinic's current time? */
export function isUpcomingAppointmentStrict(
  iso: string,
  now = new Date(),
): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > clinicWallClock(now).getTime();
}
