import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import {
  logSelfReportedDose,
  notifyReminderDue,
  saveReminderTimes,
  todayIsoDate,
  undoSelfReportedDose,
  useTodayDoseStatus,
  type DoseSlotWrite,
} from "@/lib/patient-service";
import {
  MAX_REMINDER_TIMES,
  cleanReminderTimes,
  doseSlots,
  formatTime12h,
  nextReminder,
} from "@/lib/reminders";

// ---------------------------------------------------------------------------
// Only shown when the patient has a prescription on record. Reminder times
// are the patient's own choice (up to four a day — morning and night is
// common), saved to their record. Each reminder time is its OWN dose with its
// own status, so marking the morning dose doesn't silence the evening one.
//
// The reminder itself only appears while this page is open in a browser tab
// (see reminders.ts for why a true push notification isn't possible yet).
// "I took it" is the patient's own claim, tagged as such wherever it's used —
// see fetchAdherenceHistory and the fast-lane evidence panel.
//
// One rule runs through this file: NOTHING acts on "the dose hasn't been
// taken" until the database has actually said so (`dose.loaded`). Before that
// the app doesn't know, and guessing made the reminder flash on and off and
// send a notification for a dose that was already logged.
// ---------------------------------------------------------------------------

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60";

/** Remembers, in this browser, that today's reminder for this time already
 *  produced a bell notification — so coming back to the page doesn't send it
 *  (and mark it unread again) every time. */
function notifiedKey(userId: number, time: string): string {
  return `zennith:reminder-notified:${userId}:${todayIsoDate()}:${time}`;
}
function alreadyNotified(userId: number, time: string): boolean {
  try {
    return window.localStorage.getItem(notifiedKey(userId, time)) !== null;
  } catch {
    return false; // storage unavailable — the write itself is idempotent
  }
}
function rememberNotified(userId: number, time: string): void {
  try {
    window.localStorage.setItem(notifiedKey(userId, time), "1");
  } catch {
    /* nothing to do */
  }
}

export function MedicationReminders({
  patientId,
  userId,
  med,
  savedTimes,
}: {
  patientId: string;
  /** Numeric users.userId — where the real notification is sent to, so it
   *  shows on the alerts page and the bell, not just this banner. */
  userId?: number;
  med: string;
  savedTimes: string[];
}) {
  const [times, setTimes] = useState<string[]>(savedTimes);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const dose = useTodayDoseStatus(patientId, med);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Keeps the "due" check current without needing the page reloaded.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The saved list can change from another tab/device; stay in sync with it.
  useEffect(() => {
    setTimes(savedTimes);
  }, [savedTimes]);

  const known = dose.loaded && !dose.failed;
  // A log with no per-time detail (a nurse's, or an older day-level tick)
  // covers the whole day.
  const dayCovered = known && dose.taken && dose.takenTimes === null;
  const slots = useMemo(
    () => doseSlots(times, now, dose.takenTimes ?? [], dayCovered),
    [times, now, dose.takenTimes, dayCovered],
  );
  const takenCount = slots.filter((s) => s.state === "taken").length;
  const next = useMemo(() => nextReminder(times, now), [times, now]);

  // Times that are due right now AND confirmed not-taken. Only these ever
  // produce a bell notification.
  const dueKey = known
    ? slots
        .filter((s) => s.state === "due")
        .map((s) => s.time)
        .join(",")
    : "";
  const sending = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!dueKey || userId == null) return;
    for (const time of dueKey.split(",")) {
      if (alreadyNotified(userId, time) || sending.current.has(time)) continue;
      sending.current.add(time);
      notifyReminderDue(userId, med, time)
        .then(() => rememberNotified(userId, time))
        .catch((err) => {
          sending.current.delete(time); // let a later visit try again
          console.error("Reminder notification failed:", err);
        });
    }
  }, [dueKey, userId, med]);

  const persist = async (nextTimes: string[]) => {
    const cleaned = cleanReminderTimes(nextTimes);
    setTimes(cleaned);
    setSaving(true);
    try {
      await saveReminderTimes(patientId, cleaned);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save your reminder times. Please try again.");
      setTimes(savedTimes); // roll back to what's actually saved
    } finally {
      setSaving(false);
    }
  };

  const addTime = () => {
    if (!draft) return;
    if (times.includes(draft)) {
      setDraft("");
      return;
    }
    if (times.length >= MAX_REMINDER_TIMES) {
      toast.error(`You can set up to ${MAX_REMINDER_TIMES} reminder times.`);
      return;
    }
    persist([...times, draft]);
    setDraft("");
  };

  const removeTime = (t: string) => persist(times.filter((x) => x !== t));

  const slotWrite = (time: string): DoseSlotWrite => ({
    time,
    takenTimes: dose.takenTimes ?? [],
    expected: slots.length,
  });

  const run = async (
    key: string,
    action: () => Promise<void>,
    success: string,
    failure: string,
  ) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      console.error(err);
      toast.error(failure);
    } finally {
      setBusy(null);
    }
  };

  const markSlot = (time: string) =>
    run(
      time,
      () => logSelfReportedDose(patientId, med, slotWrite(time)),
      `Marked your ${formatTime12h(time)} dose as taken`,
      "Couldn't save that. Please try again.",
    );
  const undoSlot = (time: string) =>
    run(
      time,
      () => undoSelfReportedDose(patientId, med, slotWrite(time)),
      `Marked your ${formatTime12h(time)} dose as not taken`,
      "Couldn't undo that. Please try again.",
    );
  const markDay = () =>
    run(
      "day",
      () => logSelfReportedDose(patientId, med),
      "Marked as taken for today",
      "Couldn't save that. Please try again.",
    );
  const undoDay = () =>
    run(
      "day",
      () => undoSelfReportedDose(patientId, med),
      "Marked as not taken",
      "Couldn't undo that. Please try again.",
    );

  const canUndo = dose.source === "patient";

  return (
    <div>
      {!dose.loaded && (
        <div className="mb-4 rounded-lg bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          Checking today's doses…
        </div>
      )}

      {dose.loaded && dose.failed && (
        <div className="mb-4 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
          Couldn't check today's doses right now, so we can't tell what's
          already been logged.
        </div>
      )}

      {/* ---- no reminder times yet: today is a single dose ---- */}
      {dose.loaded && times.length === 0 && (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
            known && dose.taken
              ? "border-emerald-200 bg-emerald-50"
              : "bg-secondary/40"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {known && dose.taken ? (
              <CheckCircle2 size={20} className="shrink-0 text-emerald-700" />
            ) : (
              <Clock size={18} className="shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {dose.failed
                  ? "Today's dose status unknown"
                  : known && dose.taken
                    ? "Today's dose taken"
                    : "Today's dose not taken yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {dose.failed
                  ? "We can't check right now — you can still mark it."
                  : known && dose.taken
                    ? dose.source === "nurse"
                      ? "Confirmed by your nurse."
                      : "You marked this yourself."
                    : "Add a reminder time below to be reminded."}
              </p>
            </div>
          </div>
          {known && dose.taken ? (
            canUndo && (
              <button
                onClick={undoDay}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 text-xs hover:underline disabled:opacity-60"
              >
                <Undo2 size={13} /> Undo
              </button>
            )
          ) : (
            <button
              onClick={markDay}
              disabled={busy !== null}
              className={PRIMARY_BUTTON}
            >
              {busy === "day" ? "Saving…" : "I took it today"}
            </button>
          )}
        </div>
      )}

      {/* ---- reminder times set: one row per dose ---- */}
      {times.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/40 px-4 py-2.5">
            <p className="text-sm font-semibold">Today's doses</p>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {!dose.loaded
                  ? "Checking…"
                  : dayCovered
                    ? dose.source === "nurse"
                      ? "Confirmed by your nurse"
                      : "Marked taken for the whole day"
                    : known
                      ? `${takenCount} of ${slots.length} taken`
                      : ""}
              </p>
              {dayCovered && canUndo && (
                <button
                  onClick={undoDay}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-xs hover:underline disabled:opacity-60"
                >
                  <Undo2 size={13} /> Undo
                </button>
              )}
            </div>
          </div>
          <ul className="divide-y">
            {slots.map((s) => {
              const state = known ? s.state : null;
              return (
                <li
                  key={s.time}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                    state === "due"
                      ? "border-l-4 border-amber-400 bg-amber-50"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {state === "taken" && (
                      <CheckCircle2
                        size={19}
                        className="shrink-0 text-emerald-700"
                      />
                    )}
                    {state === "due" && (
                      <Bell size={19} className="shrink-0 text-amber-700" />
                    )}
                    {state === "missed" && (
                      <AlertCircle
                        size={19}
                        className="shrink-0 text-muted-foreground"
                      />
                    )}
                    {(state === "upcoming" || state === null) && (
                      <Clock
                        size={19}
                        className="shrink-0 text-muted-foreground"
                      />
                    )}
                    <div>
                      <p className="text-sm font-semibold">
                        {formatTime12h(s.time)}
                      </p>
                      <p
                        className={`text-xs ${
                          state === "due"
                            ? "font-medium text-amber-900"
                            : state === "taken"
                              ? "text-emerald-800"
                              : "text-muted-foreground"
                        }`}
                      >
                        {state === "taken" && "Taken"}
                        {state === "due" &&
                          "Due now — time for your medication"}
                        {state === "missed" && "Not marked yet"}
                        {state === "upcoming" && "Upcoming"}
                        {state === null && ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {state === "due" && (
                      <button
                        onClick={() => markSlot(s.time)}
                        disabled={busy !== null}
                        className={PRIMARY_BUTTON}
                      >
                        {busy === s.time ? "Saving…" : "I took it"}
                      </button>
                    )}
                    {state === "missed" && (
                      <button
                        onClick={() => markSlot(s.time)}
                        disabled={busy !== null}
                        className={SECONDARY_BUTTON}
                      >
                        {busy === s.time ? "Saving…" : "I took it"}
                      </button>
                    )}
                    {state === "taken" && !dayCovered && canUndo && (
                      <button
                        onClick={() => undoSlot(s.time)}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 text-xs hover:underline disabled:opacity-60"
                      >
                        <Undo2 size={13} /> Undo
                      </button>
                    )}
                    <button
                      onClick={() => removeTime(s.time)}
                      aria-label={`Remove ${formatTime12h(s.time)} reminder`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {known &&
            !dayCovered &&
            next &&
            takenCount < slots.length &&
            !slots.some((s) => s.state === "due") && (
              <p className="border-t bg-secondary/20 px-4 py-2 text-xs text-muted-foreground">
                Next reminder: {formatTime12h(next.time)}
                {next.tomorrow ? " tomorrow" : ""}
              </p>
            )}
        </div>
      )}

      {/* ---- add a reminder time ---- */}
      <p className="mb-2 text-xs text-muted-foreground">
        {times.length === 0 ? "Reminder times" : "Add another reminder time"}
        {saving && " · saving…"}
      </p>
      {times.length === 0 && (
        <p className="mb-2 text-sm text-muted-foreground">
          No reminder times set. You can add up to {MAX_REMINDER_TIMES} — for
          example morning and night.
        </p>
      )}
      {times.length < MAX_REMINDER_TIMES && (
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Add a reminder time"
            className="rounded-md border px-2 py-1.5 text-sm"
          />
          <button
            onClick={addTime}
            disabled={!draft}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        This reminder only shows while Zennith is open in your browser. It can't
        send a notification to your phone yet.
      </p>
    </div>
  );
}
