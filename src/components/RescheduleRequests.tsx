import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { clinicWallClock } from "@/lib/clinic-time";
import { appointmentDateTimeLabel } from "@/lib/appointment-time";
import {
  MAX_REASON_LENGTH,
  acceptReschedule,
  declineReschedule,
  type RescheduleRequest,
} from "@/lib/reschedule";

// The doctor's and nurse's list of patients asking to move an appointment. Shown
// on their Appointments pages, above the diary.
//
// Answering one is the ONLY thing that changes the appointment: accepting moves
// it to the date and time chosen here, declining leaves it exactly as it was.
// Until then the original sits untouched in the diary.

const DAYS_OFFERED = 28;

/** The next days in the clinic's calendar (not the device's), as YYYY-MM-DD. */
function upcomingDays(
  extra: string[] = [],
): { value: string; label: string }[] {
  const today = clinicWallClock(new Date());
  const days = new Set<string>(extra);
  for (let i = 0; i < DAYS_OFFERED; i++)
    days.add(
      new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() + i,
        ),
      )
        .toISOString()
        .slice(0, 10),
    );
  return [...days].sort().map((value) => ({
    value,
    label: new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-ZA", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  }));
}

export function RescheduleRequests({
  requests,
  patientNames,
  actorId,
}: {
  requests: RescheduleRequest[];
  /** patientId -> name, from the appointments already on the page. */
  patientNames: Record<string, string>;
  /** The signed-in clinician's staff ID, recorded as who answered. */
  actorId: string;
}) {
  const pending = requests.filter((r) => r.status === "pending");
  if (pending.length === 0) return null;
  return (
    <section
      aria-label="Reschedule requests"
      className="mb-5 rounded-xl border border-amber-300 bg-amber-50/60"
    >
      <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3">
        <CalendarClock size={16} className="text-amber-800" />
        <h3 className="font-semibold text-amber-950">
          Reschedule requests{" "}
          <span className="ml-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs">
            {pending.length}
          </span>
        </h3>
        <span className="text-xs text-amber-900/80">
          The appointment stays in your diary as it is until you answer.
        </span>
      </div>
      <ul className="divide-y divide-amber-200">
        {pending.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            name={patientNames[r.patientId] || r.patientId}
            actorId={actorId}
          />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  request,
  name,
  actorId,
}: {
  request: RescheduleRequest;
  name: string;
  actorId: string;
}) {
  const days = useMemo(
    () => upcomingDays(request.preferredDay ? [request.preferredDay] : []),
    [request.preferredDay],
  );
  const [day, setDay] = useState(
    request.preferredDay && days.some((d) => d.value === request.preferredDay)
      ? request.preferredDay
      : (days[0]?.value ?? ""),
  );
  const [time, setTime] = useState(
    request.preferredTime ?? request.appointmentDateTime.slice(11, 16),
  );
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");

  const accept = async () => {
    setError("");
    setBusy("accept");
    try {
      await acceptReschedule({ request, date: day, time, actorId });
      toast.success(
        `Moved to ${appointmentDateTimeLabel(`${day}T${time}:00.000Z`)}`,
        {
          description:
            "The patient has been told and will be asked to confirm.",
        },
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't move the appointment.",
      );
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setError("");
    setBusy("decline");
    try {
      await declineReschedule({ request, reason: declineReason, actorId });
      toast.success("Declined — the appointment is unchanged");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't decline the request.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="px-5 py-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {name}{" "}
          <span className="font-normal text-muted-foreground">
            · {request.patientId} · {request.appointType}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Currently {appointmentDateTimeLabel(request.appointmentDateTime)}
        </p>
      </div>
      <p className="mt-1 text-muted-foreground">
        {request.reason ? <>“{request.reason}”</> : "No reason given."}
        {(request.preferredDay || request.preferredTime) && (
          <>
            {" "}
            · Prefers{" "}
            {request.preferredDay
              ? new Date(
                  `${request.preferredDay}T00:00:00.000Z`,
                ).toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })
              : "any day"}
            {request.preferredTime ? ` at ${request.preferredTime}` : ""}
          </>
        )}
      </p>

      {!declining ? (
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
            onClick={accept}
            disabled={busy !== null || !day || !time}
            className="rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-sm text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
          >
            {busy === "accept" ? "Moving…" : "Accept & move"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={busy !== null}
            className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={declineReason}
            onChange={(e) =>
              setDeclineReason(e.target.value.slice(0, MAX_REASON_LENGTH))
            }
            aria-label="Reason for declining"
            placeholder="Reason for the patient (optional)"
            className="min-w-56 flex-1 rounded-md border bg-white px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={decline}
            disabled={busy !== null}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy === "decline" ? "Declining…" : "Confirm decline"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(false)}
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
