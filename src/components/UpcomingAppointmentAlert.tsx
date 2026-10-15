import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { clinicWallClock } from "@/lib/clinic-time";
import { appointmentDateLabel } from "@/lib/appointment-time";
import { moveAppointment } from "@/lib/reschedule";
import {
  ALERT_LEAD_MIN,
  dueForAlert,
  type AlertCandidate,
} from "@/lib/upcoming-alert";

// "Starts in 25 min" prompt on the doctor and nurse Appointments pages.
//
// An hour before an appointment (and for an hour after, if nobody has acted on
// it) this asks the three things that matter: is it starting, did the patient
// not come, or does it need to move? Starting is always available; marking a
// no-show waits until the appointment's time has actually arrived (the same
// rule as the status buttons below).

const SNOOZE_MS = 10 * 60_000;

interface Appt extends AlertCandidate {
  patientName: string;
  patientId: string;
  type: string;
}

export function UpcomingAppointmentAlert({
  appointments,
  clinicianId,
  actorId,
  onStart,
  onNoShow,
}: {
  appointments: Appt[];
  clinicianId: string | undefined;
  actorId: string;
  /** Marks it In-progress. */
  onStart: (docId: string) => Promise<void>;
  /** Marks it No-show. */
  onNoShow: (docId: string) => Promise<void>;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(id);
  }, []);

  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const due = useMemo(
    () =>
      dueForAlert(appointments, now).filter(
        (d) => (snoozed[d.appointment.docId] ?? 0) <= now.getTime(),
      ),
    [appointments, now, snoozed],
  );

  // A toast the first time each one comes into range, so it's noticed even if
  // the page is scrolled or another tab is in front.
  const toasted = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const { appointment: a, minutesUntil } of due) {
      if (toasted.current.has(a.docId)) continue;
      toasted.current.add(a.docId);
      toast(
        minutesUntil > 0
          ? `${a.patientName} is due in ${minutesUntil} min (${a.time})`
          : `${a.patientName} was due at ${a.time}`,
        {
          description: "Start the appointment, mark a no-show, or reschedule.",
        },
      );
    }
  }, [due]);

  if (due.length === 0) return null;
  return (
    <section
      aria-label="Appointments starting soon"
      className="mb-5 rounded-xl border border-sky-200 bg-sky-50/70"
    >
      <div className="flex items-center gap-2 border-b border-sky-200 px-5 py-3">
        <BellRing size={16} className="text-sky-800" />
        <h3 className="font-semibold text-sky-950">
          Starting soon{" "}
          <span className="ml-1 rounded-full bg-sky-200 px-2 py-0.5 text-xs">
            {due.length}
          </span>
        </h3>
        <span className="text-xs text-sky-900/80">
          From {ALERT_LEAD_MIN} minutes before the start.
        </span>
      </div>
      <ul className="divide-y divide-sky-200">
        {due.map(({ appointment, minutesUntil }) => (
          <AlertRow
            key={appointment.docId}
            appointment={appointment}
            minutesUntil={minutesUntil}
            clinicianId={clinicianId}
            actorId={actorId}
            onStart={onStart}
            onNoShow={onNoShow}
            onSnooze={() =>
              setSnoozed((s) => ({
                ...s,
                [appointment.docId]: Date.now() + SNOOZE_MS,
              }))
            }
          />
        ))}
      </ul>
    </section>
  );
}

/** The next days in the clinic's calendar, as YYYY-MM-DD with a label. */
function nextDays(): { value: string; label: string }[] {
  const today = clinicWallClock(new Date());
  return Array.from({ length: 14 }, (_, i) => {
    const value = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + i,
      ),
    )
      .toISOString()
      .slice(0, 10);
    return {
      value,
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : appointmentDateLabel(`${value}T00:00:00.000Z`, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
    };
  });
}

function AlertRow({
  appointment: a,
  minutesUntil,
  clinicianId,
  actorId,
  onStart,
  onNoShow,
  onSnooze,
}: {
  appointment: Appt;
  minutesUntil: number;
  clinicianId: string | undefined;
  actorId: string;
  onStart: (docId: string) => Promise<void>;
  onNoShow: (docId: string) => Promise<void>;
  onSnooze: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const days = useMemo(nextDays, []);
  const [day, setDay] = useState(days[0].value);
  const [time, setTime] = useState(a.time);
  const [error, setError] = useState("");

  const started = minutesUntil <= 0;
  const run = async (key: string, fn: () => Promise<void>) => {
    setError("");
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That didn't work. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="px-5 py-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {a.patientName}{" "}
          <span className="font-normal text-muted-foreground">
            · {a.patientId} · {a.type}
          </span>
        </p>
        <p
          className={
            started
              ? "text-xs font-medium text-amber-800"
              : "text-xs text-sky-900"
          }
        >
          {started
            ? minutesUntil === 0
              ? `Due now (${a.time})`
              : `Was due at ${a.time} · ${-minutesUntil} min ago · not started`
            : `Starts in ${minutesUntil} min (${a.time})`}
        </p>
      </div>

      {!moving ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run("start", () => onStart(a.docId))}
            disabled={busy !== null}
            className="rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-sm text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
          >
            {busy === "start" ? "Starting…" : "Start (in progress)"}
          </button>
          <button
            type="button"
            onClick={() => run("noshow", () => onNoShow(a.docId))}
            disabled={busy !== null || !started}
            title={
              started
                ? undefined
                : `Available once the appointment time (${a.time}) has arrived`
            }
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "noshow" ? "Saving…" : "Mark no-show"}
          </button>
          <button
            type="button"
            onClick={() => setMoving(true)}
            disabled={busy !== null || !clinicianId}
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={onSnooze}
            disabled={busy !== null}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Remind me in 10 min
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Move to</span>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="New day"
            className="rounded-md border bg-white px-2 py-1.5 text-sm"
          >
            {days.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="New time"
            className="rounded-md border bg-white px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={busy !== null || !day || !time}
            onClick={() =>
              run("move", async () => {
                await moveAppointment({
                  appointmentId: a.docId,
                  clinician: clinicianId!,
                  patientId: a.patientId,
                  appointType: a.type,
                  fromDateTime: a.dateTime,
                  date: day,
                  time,
                  actorId,
                });
                toast.success("Appointment moved", {
                  description:
                    "The patient has been told and will be asked to confirm.",
                });
                setMoving(false);
              })
            }
            className="rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-sm text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
          >
            {busy === "move" ? "Moving…" : "Move"}
          </button>
          <button
            type="button"
            onClick={() => setMoving(false)}
            disabled={busy !== null}
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-secondary"
          >
            Back
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
