import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  notifyReminderDue,
  todayIsoDate,
  useTodayDoseStatus,
  type CurrentPatient,
} from "@/lib/patient-service";
import { dueDoseTimes, formatTime12h } from "@/lib/reminders";

// Medication reminders that fire on ANY page, not just the dashboard.
//
// The "is a dose due?" check used to live inside the dashboard's reminder card,
// so a patient on Appointments or Medical Record never got the notification -
// it only appeared once they happened to open the dashboard. This runs from
// the app shell instead, which every patient page renders.
//
// When a dose comes due it does two things, once per reminder per day:
//   * writes the notification (the bell is a live Firestore listener, so it
//     updates the moment the write lands, wherever the patient is), and
//   * shows a toast, so it's noticed without opening the bell.
//
// It is still not a push notification: it needs the app open in a browser tab
// (see reminders.ts). Nothing acts on "the dose hasn't been taken" until the
// database has said so (`dose.loaded`), exactly as before.

const CHECK_EVERY_MS = 30_000;

/** Remembers, in this browser, that today's reminder for this time was already
 *  delivered - so moving between pages (or coming back) doesn't repeat it, or
 *  mark a notification the patient already read as unread again. */
function notifiedKey(who: string | number, time: string): string {
  return `zennith:reminder-notified:${who}:${todayIsoDate()}:${time}`;
}
function alreadyNotified(who: string | number, time: string): boolean {
  try {
    return window.localStorage.getItem(notifiedKey(who, time)) !== null;
  } catch {
    return false; // storage unavailable - the write itself is idempotent
  }
}
function rememberNotified(who: string | number, time: string): void {
  try {
    window.localStorage.setItem(notifiedKey(who, time), "1");
  } catch {
    /* nothing to do */
  }
}

export function useMedicationReminderNotifier(
  patient: CurrentPatient | null | undefined,
  enabled: boolean,
): void {
  const patientId = enabled ? patient?.patientId : undefined;
  const med = patient?.prescription?.trim() || undefined;
  const times = patient?.reminderTimes;
  const userId = patient?.userId;

  // Passing no patient makes this a no-op for staff and for patients without a
  // prescription.
  const dose = useTodayDoseStatus(med ? patientId : undefined, med);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [enabled]);

  const known = dose.loaded && !dose.failed;
  const dayCovered = known && dose.taken && dose.takenTimes === null;
  const due =
    enabled && med && known && times?.length
      ? dueDoseTimes(times, now, dose.takenTimes ?? [], dayCovered)
      : [];
  const dueKey = due.join(",");

  const handling = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!dueKey || !patientId || !med) return;
    const who = userId ?? patientId;
    for (const time of dueKey.split(",")) {
      const mark = `${who}:${time}`;
      if (alreadyNotified(who, time) || handling.current.has(mark)) continue;
      handling.current.add(mark);

      // Deferred a tick: on a full page load this can run in the same commit as
      // the toaster mounting, and a toast raised before it subscribes is lost.
      const description = `Time to take your ${med} (${formatTime12h(time)}).`;
      setTimeout(
        () => toast("Medication reminder", { description, duration: 15_000 }),
        0,
      );

      if (userId == null) {
        // No account to address a bell notification to; the toast still showed.
        console.warn(
          "A medication reminder is due but this patient has no numeric userId, so no alert was added to the bell.",
        );
        rememberNotified(who, time);
        continue;
      }
      notifyReminderDue(userId, med, time)
        .then(() => rememberNotified(who, time))
        .catch((err) => {
          handling.current.delete(mark); // let the next check try again
          console.error("Reminder notification failed:", err);
        });
    }
  }, [dueKey, patientId, userId, med]);
}
