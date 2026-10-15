import { clinicWallClock } from "@/lib/clinic-time";

// When a patient asks to be reminded about an appointment "in 3 hours" or "at
// 14:00", this decides whether that is a sensible time and what real moment it
// is. Pure, so it can be tested without a browser.
//
// Appointments are stored as the clinic's WALL-CLOCK time labelled Z (see
// clinic-time.ts), not as a real UTC instant, while a reminder time chosen on
// the patient's device IS a real instant. Comparing the two directly is wrong by
// the clinic's UTC offset (two hours), so the appointment's start is converted
// to a real instant first.

export type ReminderChoice =
  | { kind: "in"; hours: number }
  | { kind: "at"; at: Date };

export type ScheduleResult =
  | { ok: true; deliverAt: Date }
  | { ok: false; reason: "started" | "in-past" | "too-late" };

/** The real moment an appointment starts, or null if its time can't be read. */
export function appointmentStartInstant(
  apptIso: string,
  now: Date,
): Date | null {
  const wall = new Date(apptIso).getTime();
  if (Number.isNaN(wall)) return null;
  // The clinic's offset from UTC, rounded to the minute (the wall clock is only
  // known to the second).
  const offset =
    Math.round((clinicWallClock(now).getTime() - now.getTime()) / 60_000) *
    60_000;
  return new Date(wall - offset);
}

/** Smallest lead time accepted, so a "specific time" of this very minute isn't sent as "later". */
const MIN_LEAD_MS = 60_000;

export function scheduleReminder(
  apptIso: string,
  choice: ReminderChoice,
  now = new Date(),
): ScheduleResult {
  const start = appointmentStartInstant(apptIso, now);
  if (start && start.getTime() <= now.getTime())
    return { ok: false, reason: "started" };

  const deliverAt =
    choice.kind === "in"
      ? new Date(now.getTime() + choice.hours * 3_600_000)
      : choice.at;
  if (
    Number.isNaN(deliverAt.getTime()) ||
    deliverAt.getTime() < now.getTime() + MIN_LEAD_MS
  )
    return { ok: false, reason: "in-past" };
  // A reminder that would arrive at or after the appointment is no reminder.
  if (start && deliverAt.getTime() >= start.getTime())
    return { ok: false, reason: "too-late" };
  return { ok: true, deliverAt };
}

export const REMINDER_PRESETS = [
  { label: "In 1 hour", hours: 1 },
  { label: "In 3 hours", hours: 3 },
] as const;

export function reminderRefusal(
  reason: Extract<ScheduleResult, { ok: false }>["reason"],
): string {
  switch (reason) {
    case "started":
      return "This appointment has already started.";
    case "in-past":
      return "That time has already passed. Pick a later time.";
    case "too-late":
      return "That's after your appointment starts. Pick an earlier time.";
  }
}
