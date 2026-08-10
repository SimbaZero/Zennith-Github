// Quiet hours: only DELIVER between 07:00 and 20:00 local time.
export const QUIET_START = 7; // 07:00
export const QUIET_END = 20; // 20:00 (8pm)

function inWindow(d: Date) {
  const h = d.getHours();
  return h >= QUIET_START && h < QUIET_END;
}

/** Next allowed delivery time on/after `from` given the quiet-hours window.
 *  Used by Receptionist's "Call Next" to time-shift a real Firestore
 *  notification (see callPatient() in clinic-data.ts) — this file used to
 *  also contain a fake, localStorage-based reminder queue that never
 *  touched Firestore and wasn't scoped per-patient (it leaked between any
 *  patient accounts signed in on the same browser). That's been removed —
 *  this file is now just the quiet-hours math, nothing else. */
export function nextAllowed(from: Date): Date {
  const d = new Date(from);
  if (inWindow(d)) return d;
  if (d.getHours() >= QUIET_END) d.setDate(d.getDate() + 1);
  d.setHours(QUIET_START, 0, 0, 0);
  return d;
}
