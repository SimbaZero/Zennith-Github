import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCircle2, Clock, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  logSelfReportedDose,
  notifyReminderDue,
  saveReminderTimes,
  todayIsoDate,
  undoSelfReportedDose,
  useTodayDoseStatus,
} from "@/lib/patient-service";
import {
  MAX_REMINDER_TIMES,
  cleanReminderTimes,
  dueReminderTime,
  formatTime12h,
  nextReminder,
} from "@/lib/reminders";

// ---------------------------------------------------------------------------
// Only shown when the patient has a prescription on record. Reminder times
// are the patient's own choice, saved to their record; the reminder itself
// only appears while this page is open in a browser tab (see reminders.ts for
// why a true push notification isn't possible yet). "I took it" is the
// patient's own claim, tagged as such wherever it's used — see
// fetchAdherenceHistory and the fast-lane evidence panel.
//
// One rule runs through this file: NOTHING acts on "the dose hasn't been
// taken" until the database has actually said so (`dose.loaded`). Before that
// the app doesn't know, and guessing made the reminder flash on and off and
// send a notification for a dose that was already logged.
// ---------------------------------------------------------------------------

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60";

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
  const [busy, setBusy] = useState(false);
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

  // Only when the database has answered, and answered "not taken yet".
  const known = dose.loaded && !dose.failed;
  const due = useMemo(
    () => (known && !dose.taken ? dueReminderTime(times, now, false) : null),
    [known, dose.taken, times, now],
  );
  const next = useMemo(() => nextReminder(times, now), [times, now]);

  // A real notification (the bell and the alerts page), once per due time per
  // day per browser. It only ever fires from `due`, which already means the
  // dose is confirmed not-taken.
  const sending = useRef<string | null>(null);
  useEffect(() => {
    if (!due || userId == null) return;
    if (alreadyNotified(userId, due) || sending.current === due) return;
    sending.current = due;
    notifyReminderDue(userId, med, due)
      .then(() => rememberNotified(userId, due))
      .catch((err) => {
        sending.current = null; // let a later visit try again
        console.error("Reminder notification failed:", err);
      });
  }, [due, userId, med]);

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

  const markTaken = async () => {
    setBusy(true);
    try {
      await logSelfReportedDose(patientId, med);
      toast.success("Marked as taken for today");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      await undoSelfReportedDose(patientId, med);
      toast.success("Marked as not taken");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't undo that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const takeButton = (label: string) => (
    <button onClick={markTaken} disabled={busy} className={PRIMARY_BUTTON}>
      {busy ? "Saving…" : label}
    </button>
  );

  return (
    <div>
      {/* ---- today's status: exactly one of these ---- */}
      {!dose.loaded && (
        <div className="mb-4 rounded-lg bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          Checking today's dose…
        </div>
      )}

      {dose.loaded && dose.failed && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Couldn't check today's dose right now, so we can't tell if it's been
            logged.
          </p>
          {takeButton("I took it today")}
        </div>
      )}

      {known && dose.taken && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={20} className="shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Today's dose taken
              </p>
              <p className="text-xs text-emerald-800">
                {dose.source === "nurse"
                  ? "Confirmed by your nurse."
                  : "You marked this yourself."}
              </p>
            </div>
          </div>
          {dose.source === "patient" && (
            <button
              onClick={undo}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs text-emerald-900 hover:underline disabled:opacity-60"
            >
              <Undo2 size={13} /> Undo
            </button>
          )}
        </div>
      )}

      {known && !dose.taken && due && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <Bell size={20} className="shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-amber-950">
                It's time for your medication
              </p>
              <p className="text-xs text-amber-900">
                Your {formatTime12h(due)} reminder.
              </p>
            </div>
          </div>
          {takeButton("I took it")}
        </div>
      )}

      {known && !dose.taken && !due && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/40 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">
                Today's dose not taken yet
              </p>
              <p className="text-xs text-muted-foreground">
                {next
                  ? `Next reminder: ${formatTime12h(next.time)}${next.tomorrow ? " tomorrow" : ""}`
                  : "No reminder times set — add one below."}
              </p>
            </div>
          </div>
          {takeButton("I took it today")}
        </div>
      )}

      {/* ---- reminder times ---- */}
      <p className="mb-2 text-xs text-muted-foreground">
        Reminder times
        {saving && " · saving…"}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {times.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No reminder times set.
          </p>
        )}
        {times.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.88_0.05_245)] bg-[oklch(0.95_0.03_245)] py-1 pl-3 pr-1.5 text-sm text-[oklch(0.3_0.1_255)]"
          >
            {formatTime12h(t)}
            <button
              onClick={() => removeTime(t)}
              aria-label={`Remove ${formatTime12h(t)} reminder`}
              className="text-[oklch(0.45_0.08_255)] hover:text-destructive"
            >
              <Trash2 size={13} />
            </button>
          </span>
        ))}
      </div>

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
