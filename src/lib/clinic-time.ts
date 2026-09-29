/*
 * Time zones: clinic-data.ts stores appointDateTime as the clinic's wall-clock
 * time with a "Z" suffix (`${date}T${time}:00.000Z`), so a 10:00 SAST
 * appointment is stored as 10:00Z. Server code comparing against "now" must
 * use the clinic's wall-clock time in that same frame; comparing with the real
 * UTC clock puts everything two hours late.
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
