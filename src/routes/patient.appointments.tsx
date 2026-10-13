import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientAppointments,
  updateAppointmentStatus,
  requestAppointmentReminder,
  notifyCancellationReason,
  type PatientAppointmentRow,
} from "@/lib/patient-service";
import { isOffline } from "@/lib/offline";
import {
  appointmentDateLabel,
  appointmentTime,
  hasAppointmentPassed,
} from "@/lib/appointment-time";
import { Check, X, Bell, Lock, CalendarClock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  REMINDER_PRESETS,
  appointmentStartInstant,
  reminderRefusal,
  scheduleReminder,
} from "@/lib/reminder-schedule";
import {
  MAX_REASON_LENGTH,
  requestReschedule,
  usePatientReschedules,
  withdrawReschedule,
  type RescheduleRequest,
} from "@/lib/reschedule";
import { toast } from "sonner";
import {
  patientStatusView,
  type PatientStatusTone,
} from "@/lib/patient-appointment-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/patient/appointments")({
  component: PatientAppointments,
  validateSearch: (s: Record<string, unknown>) => ({
    confirm: typeof s.confirm === "string" ? s.confirm : undefined,
  }),
});

const TONE_STYLE: Record<PatientStatusTone, string> = {
  // Two different words AND two different colours: a missed visit and a
  // cancelled one are not the same thing and shouldn't read as if they were.
  cancelled: "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]",
  missed: "bg-[oklch(0.95_0.09_85)] text-[oklch(0.38_0.12_70)]",
  completed: "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]",
  progress: "bg-[oklch(0.94_0.05_200)] text-[oklch(0.35_0.1_200)]",
  open: "bg-[oklch(0.96_0.05_245)] text-[oklch(0.4_0.15_245)]",
};

function AppointmentStatusBadge({
  status,
  dateTime,
}: {
  status: string;
  dateTime: string;
}) {
  const { label, tone } = patientStatusView(status, dateTime);
  // "Confirmed" keeps its green; the rest come from the tone.
  const style =
    tone === "open" && /confirm/i.test(label)
      ? TONE_STYLE.completed
      : TONE_STYLE[tone];
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

// Read the stored clinic time as it is — see appointment-time.ts. These used to
// convert it through the device's timezone and show it two hours late.
const formatDate = appointmentDateLabel;
const formatTime = appointmentTime;

// Soft lock: anything already in the past, Completed, or Cancelled can no
// longer be touched by the patient. Only upcoming, still-open appointments
// are actionable (matches Doc-1/Nur-1 style real-name resolution already
// done upstream in usePatientAppointments).
function isLocked(a: PatientAppointmentRow, now: Date): boolean {
  return (
    hasAppointmentPassed(a.dateTime, now) ||
    a.status === "Cancelled" ||
    a.status === "Completed"
  );
}

function PatientAppointments() {
  const { confirm } = useSearch({ from: "/patient/appointments" });
  const { patient } = useCurrentPatient();
  const appointments = usePatientAppointments(patient?.patientId);
  const reschedules = usePatientReschedules();

  // If opened via an SMS-style confirm link (?confirm=<docId>), write the
  // real confirmation to Firestore once. The ref guards against re-firing
  // on every re-render.
  const confirmedRef = useRef<string | null>(null);
  const [pastLimit, setPastLimit] = useState(5);
  useEffect(() => {
    if (confirm && confirmedRef.current !== confirm) {
      confirmedRef.current = confirm;
      updateAppointmentStatus(confirm, "Confirmed")
        .then(() =>
          toast.success(
            isOffline()
              ? "Confirmation saved on this device — it will reach the clinic when you're back online"
              : "Appointment confirmed via SMS link",
          ),
        )
        .catch((err) => {
          console.error(err);
          toast.error("Couldn't confirm appointment. Please try again.");
        });
    }
  }, [confirm]);

  const now = new Date();

  // Current/upcoming first (soonest first), past ones below (most recent
  // past first).
  const upcoming = appointments
    .filter((a) => !isLocked(a, now))
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  const past = appointments
    .filter((a) => isLocked(a, now))
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));

  // Clicking the ALREADY-ACTIVE button undoes it back to "Scheduled" instead
  // of doing nothing — so patients aren't locked into a choice. Clicking the
  // other (inactive) button switches straight to that status as before.
  // Cancelling asks first, with an optional reason; undoing a cancellation (or
  // confirming) goes straight through as it always did.
  const [cancelFor, setCancelFor] = useState<PatientAppointmentRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const askCancel = (a: PatientAppointmentRow) => {
    setCancelReason("");
    setCancelFor(a);
  };

  const toggleStatus = async (
    docId: string,
    currentStatus: string,
    target: "Confirmed" | "Cancelled",
    reason = "",
  ) => {
    const nextStatus = currentStatus === target ? "Scheduled" : target;
    try {
      await updateAppointmentStatus(
        docId,
        nextStatus as "Confirmed" | "Cancelled",
      );
      // Offline these are queued, so the clinic hasn't seen them yet — a
      // patient told "clinic will be notified" would reasonably stop there
      // and not follow up.
      toast.success(
        isOffline()
          ? "Saved on this device — it will reach the clinic when you're back online"
          : nextStatus === "Scheduled"
            ? "Reverted to scheduled"
            : nextStatus === "Confirmed"
              ? "Appointment confirmed"
              : "Appointment cancelled — clinic will be notified",
      );
      // Only when the patient actually wrote one: no reason, no extra step.
      if (nextStatus === "Cancelled" && reason.trim()) {
        const appt = appointments.find((x) => x.docId === docId);
        if (appt && patient?.patientId)
          void notifyCancellationReason(appt, patient.patientId, reason);
      }
    } catch (err) {
      console.error(err);
      // The Firebase code tells "the rules refused this" (permission-denied)
      // apart from "you're offline" or "that appointment is gone".
      const code = (err as { code?: string })?.code;
      toast.error("Failed to update appointment. Please try again.", {
        description: code ? `Reason: ${code}` : undefined,
      });
    }
  };

  const askReschedule = async (
    a: PatientAppointmentRow,
    detail: { reason: string; preferredDay?: string; preferredTime?: string },
  ): Promise<boolean> => {
    if (!patient?.patientId) {
      toast.error("Can't send a request — your record isn't loaded yet.");
      return false;
    }
    try {
      await requestReschedule({
        appointment: {
          docId: a.docId,
          dateTime: a.dateTime,
          type: a.type,
          clinician: a.clinicianId,
        },
        patientId: patient.patientId,
        patientUserId: patient.userId,
        ...detail,
      });
      toast.success("Reschedule request sent", {
        description:
          "Your appointment stays as it is until the clinic answers. You'll get a notification.",
      });
      return true;
    } catch (err) {
      console.error(err);
      const code = (err as { code?: string })?.code;
      toast.error("Couldn't send the request. Please try again.", {
        description: code ? `Reason: ${code}` : undefined,
      });
      return false;
    }
  };

  const withdraw = async (r: RescheduleRequest) => {
    try {
      await withdrawReschedule(r.id);
      toast.success("Request withdrawn — your appointment is unchanged");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't withdraw the request. Please try again.");
    }
  };

  const scheduleReminderFor = async (
    a: PatientAppointmentRow,
    deliverAt: Date,
  ): Promise<boolean> => {
    if (patient?.userId == null) {
      toast.error("Can't set a reminder — no linked account found.");
      return false;
    }
    try {
      await requestAppointmentReminder(a, patient.userId, deliverAt);
      toast.success(`We'll remind you ${describeWhen(deliverAt)}`, {
        description:
          "It will appear in your notifications then. We can't send it to your phone yet.",
      });
      return true;
    } catch (err) {
      console.error(err);
      const code = (err as { code?: string })?.code;
      toast.error("Couldn't set the reminder. Please try again.", {
        description: code ? `Reason: ${code}` : undefined,
      });
      return false;
    }
  };

  return (
    <AppShell role="patient" title="My Appointments">
      <div className="bg-white rounded-xl border overflow-hidden mb-6">
        <div className="p-5 border-b flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold">Upcoming</h3>
          <span className="text-xs text-muted-foreground">
            SMS reminders sent one day prior include a Confirm link.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Clinician</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No upcoming appointments.
                  </td>
                </tr>
              )}
              {upcoming.map((a, i) => {
                const isNext = i === 0;
                const pending = a.status !== "Confirmed";
                const asks = reschedules.filter(
                  (r) => r.appointmentId === a.docId,
                );
                const openAsk = asks.find((r) => r.status === "pending");
                const declined =
                  !openAsk && asks[0]?.status === "declined" ? asks[0] : null;
                return (
                  <tr
                    id={`appt-${a.docId}`}
                    key={a.docId}
                    className={`border-t ${isNext ? "bg-[oklch(0.97_0.05_245)]" : ""}`}
                  >
                    <td className="px-5 py-3.5 font-medium">
                      <div>{formatDate(a.dateTime)}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {formatTime(a.dateTime)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {a.clinician}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AppointmentStatusBadge status={a.status} dateTime={a.dateTime} />
                        {isNext && pending && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[oklch(0.94_0.1_75)] text-[oklch(0.4_0.15_75)]">
                            Next · pending confirmation
                          </span>
                        )}
                        {openAsk && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[oklch(0.95_0.07_85)] text-[oklch(0.4_0.12_70)]">
                            Reschedule requested · waiting for the clinic
                          </span>
                        )}
                      </div>
                      {declined && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reschedule declined
                          {declined.declineReason
                            ? `: ${declined.declineReason}`
                            : "."}{" "}
                          Your appointment stays as it was.
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          disabled={a.status === "Cancelled"}
                          onClick={() =>
                            toggleStatus(a.docId, a.status, "Confirmed")
                          }
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Confirmed"
                              ? "bg-[oklch(0.94_0.08_160)] border-[oklch(0.7_0.1_160)]"
                              : "hover:bg-[oklch(0.97_0.06_160)]"
                          }`}
                          title={
                            a.status === "Confirmed"
                              ? "Click to undo confirmation"
                              : "Confirm this appointment"
                          }
                        >
                          <Check size={12} />{" "}
                          {a.status === "Confirmed" ? "Confirmed" : "Confirm"}
                        </button>
                        <button
                          disabled={a.status === "Confirmed"}
                          onClick={() =>
                            a.status === "Cancelled"
                              ? toggleStatus(a.docId, a.status, "Cancelled")
                              : askCancel(a)
                          }
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Cancelled"
                              ? "bg-[oklch(0.94_0.08_25)] border-[oklch(0.7_0.15_25)]"
                              : "hover:bg-[oklch(0.97_0.05_25)]"
                          }`}
                          title={
                            a.status === "Cancelled"
                              ? "Click to undo cancellation"
                              : "Cancel this appointment"
                          }
                        >
                          <X size={12} />{" "}
                          {a.status === "Cancelled" ? "Cancelled" : "Cancel"}
                        </button>
                        {pending && (
                          <RemindMe
                            appointment={a}
                            onSchedule={(at) => scheduleReminderFor(a, at)}
                          />
                        )}
                        {a.status !== "Cancelled" &&
                          (openAsk ? (
                            <button
                              type="button"
                              onClick={() => withdraw(openAsk)}
                              className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-secondary"
                              title="Take your reschedule request back"
                            >
                              <CalendarClock size={12} /> Withdraw request
                            </button>
                          ) : (
                            <RequestReschedule
                              appointment={a}
                              onSubmit={(detail) => askReschedule(a, detail)}
                            />
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold">Past Appointments</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Locked — completed, cancelled, or already-passed appointments can't
            be changed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Clinician</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {past.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No past appointments.
                  </td>
                </tr>
              )}
              {/* A chronic patient can accumulate hundreds of past visits,
                  so this shows the most recent few rather than everything. */}
              {past.slice(0, pastLimit).map((a) => {
                return (
                  <tr
                    id={`appt-${a.docId}`}
                    key={a.docId}
                    className="border-t text-muted-foreground"
                  >
                    <td className="px-5 py-3.5 font-medium">
                      <div>{formatDate(a.dateTime)}</div>
                      <div className="text-xs font-mono">
                        {formatTime(a.dateTime)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {a.clinician}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <AppointmentStatusBadge status={a.status} dateTime={a.dateTime} />
                        <Lock size={12} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {past.length > 5 && (
            <div className="flex gap-2 p-4 border-t">
              {past.length > pastLimit && (
                <button
                  onClick={() => setPastLimit((n) => n + 10)}
                  className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                >
                  Show more ({past.length - pastLimit} older)
                </button>
              )}
              {pastLimit > 5 && (
                <button
                  onClick={() => setPastLimit(5)}
                  className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                >
                  Collapse
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <AlertDialog
        open={cancelFor !== null}
        onOpenChange={(o) => {
          if (!o) setCancelFor(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelFor
                ? `${cancelFor.type} · ${formatDate(cancelFor.dateTime)}, ${formatTime(cancelFor.dateTime)}. The clinic will be told.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label
              htmlFor="cancel-reason"
              className="text-sm font-medium block mb-1"
            >
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) =>
                setCancelReason(e.target.value.slice(0, MAX_REASON_LENGTH))
              }
              rows={3}
              placeholder="You can leave this blank"
              className="w-full resize-none rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const a = cancelFor;
                if (a) toggleStatus(a.docId, a.status, "Cancelled", cancelReason);
                setCancelFor(null);
              }}
            >
              Cancel appointment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/** "in 3 hours' time" is awkward; this reads "today at 14:00", "tomorrow at 09:30" or "on Thu 15 Oct at 08:00". */
function describeWhen(at: Date, now = new Date()): string {
  const time = at.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dayStart = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const date = at.toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `on ${date} at ${time}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "Remind me": pick WHEN, instead of getting the notification at once. Choices
 * that would arrive at or after the appointment are switched off, with the reason.
 */
function RemindMe({
  appointment,
  onSchedule,
}: {
  appointment: PatientAppointmentRow;
  onSchedule: (at: Date) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  // Days offered for a specific time: today up to the day of the appointment.
  const days = (() => {
    const now = new Date();
    const start = appointmentStartInstant(appointment.dateTime, now);
    const last = start ? localDay(start) : localDay(now);
    const out: { value: string; label: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({
        value: localDay(d),
        label:
          i === 0
            ? "Today"
            : i === 1
              ? "Tomorrow"
              : d.toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
      });
      if (localDay(d) >= last) break;
    }
    return out;
  })();

  const choose = async (choice: Parameters<typeof scheduleReminder>[1]) => {
    const result = scheduleReminder(appointment.dateTime, choice);
    if (!result.ok) {
      setError(reminderRefusal(result.reason));
      return;
    }
    setError("");
    setBusy(true);
    const done = await onSchedule(result.deliverAt);
    setBusy(false);
    if (done) setOpen(false);
  };

  const presetState = (hours: number) => {
    const r = scheduleReminder(appointment.dateTime, { kind: "in", hours });
    return r.ok ? null : reminderRefusal(r.reason);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setError("");
          setDay(days[0]?.value ?? "");
          setTime("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-[oklch(0.97_0.05_245)]"
          title="Choose when to be reminded"
        >
          <Bell size={12} /> Remind me
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="w-72 overflow-auto"
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
      >
        <p className="text-sm font-medium mb-2">Remind me about this</p>
        <div className="space-y-1.5">
          {REMINDER_PRESETS.map((p) => {
            const refusal = presetState(p.hours);
            return (
              <button
                key={p.hours}
                type="button"
                disabled={busy || !!refusal}
                title={refusal ?? undefined}
                onClick={() => choose({ kind: "in", hours: p.hours })}
                className="w-full text-left text-sm border rounded-md px-3 py-1.5 hover:bg-secondary disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs font-medium text-muted-foreground mt-3 mb-1.5">
          Or at a specific time
        </p>
        <div className="flex gap-2">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Day"
            className="flex-1 min-w-0 border rounded-md px-2 py-1.5 text-sm bg-white"
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
            aria-label="Time"
            className="border rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={busy || !day || !time}
          onClick={() =>
            choose({ kind: "at", at: new Date(`${day}T${time}:00`) })
          }
          className="w-full mt-2 bg-[oklch(0.18_0.06_260)] text-white text-sm rounded-md py-1.5 hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
        >
          {busy ? "Setting…" : "Set reminder"}
        </button>

        {error && (
          <p role="alert" className="text-xs text-destructive mt-2">
            {error}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          It appears in your notifications at that time. We can't send it to
          your phone yet.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Request reschedule": asks the clinic to move this appointment. Nothing about
 * the appointment changes until a doctor or nurse accepts - so it can't be used
 * to lose a slot by accident, which is why this isn't a "move it" button.
 */
function RequestReschedule({
  appointment,
  onSubmit,
}: {
  appointment: PatientAppointmentRow;
  onSubmit: (detail: {
    reason: string;
    preferredDay?: string;
    preferredTime?: string;
  }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");

  const days = (() => {
    const now = new Date();
    return Array.from({ length: 21 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      return {
        value: localDay(d),
        label:
          i === 0
            ? "Today"
            : i === 1
              ? "Tomorrow"
              : d.toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
      };
    });
  })();

  const submit = async () => {
    setBusy(true);
    const done = await onSubmit({
      reason,
      preferredDay: day || undefined,
      preferredTime: time || undefined,
    });
    setBusy(false);
    if (done) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setReason("");
          setDay("");
          setTime("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-secondary"
          title="Ask the clinic to move this appointment"
        >
          <CalendarClock size={12} /> Request reschedule
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="w-80 overflow-auto"
        style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
      >
        <p className="text-sm font-medium">Ask to reschedule</p>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          {appointment.type} · {formatDate(appointment.dateTime)},{" "}
          {formatTime(appointment.dateTime)}. Your appointment stays exactly as
          it is until the clinic accepts a new time.
        </p>

        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Why? (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) =>
            setReason(e.target.value.slice(0, MAX_REASON_LENGTH))
          }
          rows={3}
          className="w-full border rounded-md px-2 py-1.5 text-sm resize-none"
          placeholder="e.g. I'm at work that day"
        />

        <p className="text-xs font-medium text-muted-foreground mt-3 mb-1">
          Would another time suit you? (optional)
        </p>
        <div className="flex gap-2">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Preferred day"
            className="flex-1 min-w-0 border rounded-md px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Any day</option>
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
            aria-label="Preferred time"
            className="border rounded-md px-2 py-1.5 text-sm"
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="w-full mt-3 bg-[oklch(0.18_0.06_260)] text-white text-sm rounded-md py-1.5 hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </PopoverContent>
    </Popover>
  );
}
