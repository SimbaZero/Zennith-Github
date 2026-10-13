import { clinicWallClock } from "@/lib/clinic-time";
import { isPastDay } from "@/lib/appointment-time";
import type { AppointmentStatus } from "@/components/AppShell";

// Which appointments should be putting a prompt in front of the doctor or nurse
// right now. An appointment that is about to start (or has started and nobody
// has moved it on) is easy to lose among a day's list; this is the nudge that
// asks the three questions that matter: is it starting, did they not come, or
// does it need to move?

/** How long before the start the prompt appears. */
export const ALERT_LEAD_MIN = 60;
/** How long after the start it keeps asking, if the appointment is still unhandled. */
export const ALERT_OVERDUE_MIN = 60;

/** Statuses where something is still to be decided; anything else has been dealt with. */
const OPEN: readonly AppointmentStatus[] = [
  "Scheduled",
  "Confirmed",
  "Incomplete",
];

export interface AlertCandidate {
  docId: string;
  date: string;
  time: string;
  dateTime: string;
  status: AppointmentStatus;
}

export interface UpcomingAlert<T extends AlertCandidate> {
  appointment: T;
  /** Minutes until the start; negative once it has begun. */
  minutesUntil: number;
}

/** Whole minutes from the clinic's current time to the appointment's start. */
export function minutesUntilStart(
  dateTimeIso: string,
  now: Date,
): number | null {
  const start = Date.parse(dateTimeIso);
  if (!Number.isFinite(start)) return null;
  return Math.round((start - clinicWallClock(now).getTime()) / 60_000);
}

/** The appointments that need a prompt right now, soonest first. */
export function dueForAlert<T extends AlertCandidate>(
  appointments: T[],
  now: Date,
): UpcomingAlert<T>[] {
  const out: UpcomingAlert<T>[] = [];
  for (const appointment of appointments) {
    if (!OPEN.includes(appointment.status)) continue;
    if (isPastDay(appointment.date, now)) continue;
    const minutesUntil = minutesUntilStart(appointment.dateTime, now);
    if (minutesUntil == null) continue;
    if (minutesUntil > ALERT_LEAD_MIN || minutesUntil < -ALERT_OVERDUE_MIN)
      continue;
    out.push({ appointment, minutesUntil });
  }
  return out.sort((a, b) => a.minutesUntil - b.minutesUntil);
}
