// ---------------------------------------------------------------------------
// Medication reminders — patient-set times, and the record of doses they say
// they took.
//
// What this is NOT: a push notification. A reminder the app cannot show
// unless it is open in a browser tab needs a server sending messages on a
// schedule, which needs a paid Firebase plan (see the TODO(infra) note this
// project already has). This shows a reminder banner only while the app is
// open — a real thing, just a smaller one than "notify me on my phone".
//
// What "I took it" means: it is the PATIENT's own claim, not a clinical
// observation. It is stored with source: "patient" so it is never confused
// with a dose a nurse actually witnessed and logged (source: "nurse"), and it
// is shown to clinicians as evidence to weigh, never as an automatic score —
// see fastLaneEvidence below and the fast-lane toggle in nurse/doctor-service.
// ---------------------------------------------------------------------------

export const MAX_REMINDER_TIMES = 4;

/** 24-hour "HH:MM", e.g. "08:00" or "21:30". */
export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function sortTimes(times: string[]): string[] {
  return [...times].sort();
}

export function dedupeTimes(times: string[]): string[] {
  return Array.from(new Set(times));
}

/** What the patient may save: valid, unique times, oldest-first, capped. */
export function cleanReminderTimes(raw: string[]): string[] {
  return sortTimes(dedupeTimes(raw.filter(isValidTimeString))).slice(
    0,
    MAX_REMINDER_TIMES,
  );
}

/** "08:00" -> "8:00 AM". Falls back to the raw text if it isn't a real time,
 *  so a bad value never crashes the page — it just looks odd, which is a
 *  visible bug rather than a broken one. */
export function formatTime12h(value: string): string {
  if (!isValidTimeString(value)) return value;
  const [h, m] = value.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * The reminder time that is due right now, or null. "Due" means: the app has
 * been open within `windowMinutes` of that time, and the dose has not
 * already been marked taken today. Once the window passes, that time is not
 * shown again today — a missed reminder should not nag for hours.
 */
export function dueReminderTime(
  times: string[],
  now: Date,
  takenToday: boolean,
  windowMinutes = 30,
): string | null {
  if (takenToday) return null;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const t of times) {
    if (!isValidTimeString(t)) continue;
    const [h, m] = t.split(":").map(Number);
    const target = h * 60 + m;
    if (nowMinutes >= target && nowMinutes < target + windowMinutes) {
      return t;
    }
  }
  return null;
}

// ---- fast-lane evidence -----------------------------------------------------

export interface AdherenceLogEntry {
  date: string; // YYYY-MM-DD
  taken: boolean;
  source: "patient" | "nurse";
}

export interface AdherenceSummary {
  /** Doses logged as taken, out of the days that have a log at all. Days
   *  with no log are not counted as missed — no log usually just means no
   *  reminder time was set yet, not that a dose was skipped. */
  loggedDays: number;
  takenDays: number;
  /** 0–100, or null when there is nothing logged to judge. */
  percentage: number | null;
  /** taken=true entries logged by the patient themself, not witnessed. */
  selfReportedDays: number;
}

/** A plain summary for a clinician to weigh — not a verdict. Deduplicates by
 *  date (the newer entry for a date wins) before counting. */
export function summarizeAdherence(
  entries: AdherenceLogEntry[],
): AdherenceSummary {
  const byDate = new Map<string, AdherenceLogEntry>();
  for (const e of entries) byDate.set(e.date, e);
  const days = [...byDate.values()];
  const taken = days.filter((d) => d.taken);
  return {
    loggedDays: days.length,
    takenDays: taken.length,
    percentage:
      days.length === 0 ? null : Math.round((taken.length / days.length) * 100),
    selfReportedDays: taken.filter((d) => d.source === "patient").length,
  };
}
