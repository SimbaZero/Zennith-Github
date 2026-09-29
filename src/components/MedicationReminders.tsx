import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  logSelfReportedDose,
  notifyReminderDue,
  saveReminderTimes,
  useTodayDoseTaken,
} from "@/lib/patient-service";
import {
  MAX_REMINDER_TIMES,
  cleanReminderTimes,
  dueReminderTime,
  formatTime12h,
} from "@/lib/reminders";

// ---------------------------------------------------------------------------
// Only shown when the patient has a prescription on record. Reminder times
// are the patient's own choice, saved to their record; the reminder itself
// only appears while this page is open in a browser tab (see reminders.ts for
// why a true push notification isn't possible yet). "I took it" is the
// patient's own claim, tagged as such wherever it's used — see
// fetchAdherenceHistory and the fast-lane evidence panel.
// ---------------------------------------------------------------------------

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
  const takenToday = useTodayDoseTaken(patientId, med);
  const [markingTaken, setMarkingTaken] = useState(false);
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

  const due = useMemo(
    () => dueReminderTime(times, now, takenToday),
    [times, now, takenToday],
  );

  // A real notification (visible on the alerts page and the bell), sent once
  // per due window — not every 30s while the banner is showing.
  const [notifiedFor, setNotifiedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!due || due === notifiedFor || userId == null) return;
    setNotifiedFor(due);
    notifyReminderDue(userId, med, due).catch((err) =>
      console.error("Reminder notification failed:", err),
    );
  }, [due, notifiedFor, userId, med]);

  const persist = async (next: string[]) => {
    const cleaned = cleanReminderTimes(next);
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
    setMarkingTaken(true);
    try {
      await logSelfReportedDose(patientId, med);
      toast.success("Marked as taken for today");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that. Please try again.");
    } finally {
      setMarkingTaken(false);
    }
  };

  return (
    <div>
      {due && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900 flex items-center gap-2">
            <Bell size={15} className="shrink-0" />
            Reminder: it's about {formatTime12h(due)} — time for your
            medication.
          </p>
          <button
            onClick={markTaken}
            disabled={markingTaken}
            className="shrink-0 text-xs bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {markingTaken ? "Saving…" : "I took it"}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">
          Reminder times
          {saving && " · saving…"}
        </p>
        {!due && (
          <button
            onClick={markTaken}
            disabled={markingTaken}
            className="text-xs inline-flex items-center gap-1 text-[oklch(0.55_0.18_245)] hover:underline disabled:opacity-60"
          >
            <Check size={13} />
            {takenToday ? "Marked taken today" : "Mark today's dose as taken"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        {times.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No reminder times set.
          </p>
        )}
        {times.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 text-sm bg-secondary rounded-full pl-3 pr-1.5 py-1"
          >
            {formatTime12h(t)}
            <button
              onClick={() => removeTime(t)}
              aria-label={`Remove ${formatTime12h(t)} reminder`}
              className="text-muted-foreground hover:text-destructive"
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
            className="border rounded-md px-2 py-1.5 text-sm"
          />
          <button
            onClick={addTime}
            disabled={!draft}
            className="text-xs inline-flex items-center gap-1 border rounded-md px-2.5 py-1.5 hover:bg-secondary disabled:opacity-40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-2">
        This reminder only shows while Zennith is open in your browser. It can't
        send a notification to your phone yet.
      </p>
    </div>
  );
}
