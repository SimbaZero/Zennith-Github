import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  StatusBadge,
  type AppointmentStatus,
} from "@/components/AppShell";
import { useCurrentDoctor, useDoctorAppointments } from "@/lib/doctor-service";
import { setAppointmentStatus, createAppointment } from "@/lib/clinic-data";
import { OUTCOME_STATUSES, isOutcomeLocked } from "@/lib/appointment-time";
import {
  Plus,
  Check,
  Clock,
  X,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const Route = createFileRoute("/doctor/appointments")({
  validateSearch: (s: Record<string, unknown>): { date?: string } =>
    typeof s.date === "string" ? { date: s.date } : {},
  component: DoctorAppointments,
});

// The calendar hands back a Date at LOCAL midnight; read its local parts. (toIso
// below uses UTC, which would move the chosen day back one in South Africa.)
function toIsoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromIsoDay(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Sunday -> Saturday, anchored on whichever date is currently selected —
// same convention as Nurse's rebuilt Appointments page. This replaces
// Schedule's fixed Monday-start, current-week-only view entirely — Schedule
// has been deleted, this page now covers everything it used to plus real
// navigation and booking.
function weekDatesFor(anchorIso: string): string[] {
  const anchor = new Date(anchorIso + "T00:00:00");
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return toIso(d);
  });
}

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DoctorAppointments() {
  const { date: searchDate } = Route.useSearch();
  const { doctor } = useCurrentDoctor();
  const { appointments, loading } = useDoctorAppointments(doctor?.doctorId);

  const today = toIso(new Date());
  const [selected, setSelected] = useState(searchDate ?? today);
  const weekDates = useMemo(() => weekDatesFor(selected), [selected]);

  const apptsByDate = useMemo(() => {
    const map: Record<string, typeof appointments> = {};
    for (const d of weekDates) map[d] = [];
    for (const a of appointments) {
      if (map[a.date]) map[a.date].push(a);
    }
    return map;
  }, [appointments, weekDates]);

  const dayAppts = apptsByDate[selected] ?? [];

  const shiftWeek = (days: number) => {
    const d = new Date(selected + "T00:00:00");
    d.setDate(d.getDate() + days);
    setSelected(toIso(d));
  };

  // Complete / No-show / Incomplete stay greyed out until the appointment's time
  // has arrived, and unlock by themselves (no reload) once it does.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const outcomeLocked = (a: { date: string; time: string }, status: string) =>
    OUTCOME_STATUSES.includes(status) && isOutcomeLocked(a.date, a.time, clock);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [staged, setStaged] = useState<Record<string, AppointmentStatus>>({});

  const stageStatus = (
    docId: string,
    status: AppointmentStatus,
    currentStatus: AppointmentStatus,
  ) => {
    setStaged((s) => {
      const next = { ...s };
      if (status === currentStatus) delete next[docId];
      else next[docId] = status;
      return next;
    });
  };

  const confirmStatus = async (docId: string) => {
    const status = staged[docId];
    if (!status) return;
    const appt = appointments.find((x) => x.docId === docId);
    if (appt && outcomeLocked(appt, status)) {
      toast.error(`That can't be recorded before ${appt.time}`);
      return;
    }
    setPendingId(docId);
    try {
      await setAppointmentStatus(docId, status);
      toast.success(`Marked as ${status}`);
      setStaged((s) => {
        const next = { ...s };
        delete next[docId];
        return next;
      });
    } catch {
      toast.error("Could not update status");
    } finally {
      setPendingId(null);
    }
  };

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    patientId: "",
    date: today,
    time: "09:00",
    type: "Follow-up",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim())
      return toast.error("Patient ID is required (e.g. Pat-828)");
    if (!draft.date || !draft.time)
      return toast.error("Date and time are required");

    setSaving(true);
    try {
      await createAppointment({
        ...draft,
        clinician: doctor?.doctorId,
        actorId: doctor?.doctorId,
      });
      toast.success(
        `Appointment booked for ${draft.patientId} on ${draft.date} at ${draft.time}`,
      );
      setDraft({ ...draft, patientId: "" });
      setShowForm(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not book appointment",
      );
    } finally {
      setSaving(false);
    }
  };

  const actions: { status: AppointmentStatus; icon: any; cls: string }[] = [
    {
      status: "Complete",
      icon: Check,
      cls: "bg-[oklch(0.55_0.18_150)] text-white",
    },
    {
      status: "In-progress",
      icon: Clock,
      cls: "bg-[oklch(0.6_0.16_165)] text-white",
    },
    {
      status: "Incomplete",
      icon: AlertCircle,
      cls: "bg-[oklch(0.78_0.17_85)] text-[oklch(0.25_0.08_70)]",
    },
    { status: "No-show", icon: X, cls: "bg-[oklch(0.55_0.22_25)] text-white" },
  ];

  return (
    <AppShell role="doctor" title="Appointments">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftWeek(-7)}
            className="p-1.5 border rounded-md hover:bg-secondary bg-white"
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-muted-foreground">
            {weekDates[0]} – {weekDates[6]}
          </span>
          <button
            onClick={() => shiftWeek(7)}
            className="p-1.5 border rounded-md hover:bg-secondary bg-white"
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {/* Not a native <input type="date">: the browser draws that picker
            itself, outside the page, and it can run off the edge of a small or
            narrow window with nothing we can do about it. This popover flips and
            shifts to stay inside the window, and scrolls if there isn't room. */}
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Choose a date"
              className="flex items-center gap-1.5 text-sm border rounded-md px-2 py-1.5 hover:bg-secondary bg-white"
            >
              <CalendarDays size={14} className="text-muted-foreground" />
              {selected}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={8}
            className="w-auto p-0 overflow-auto"
            style={{
              maxHeight: "var(--radix-popover-content-available-height)",
              maxWidth: "var(--radix-popover-content-available-width)",
            }}
          >
            <Calendar
              mode="single"
              selected={fromIsoDay(selected)}
              defaultMonth={fromIsoDay(selected)}
              onSelect={(d) => {
                if (!d) return;
                setSelected(toIsoDay(d));
                setCalendarOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground mb-2">
          Loading appointments…
        </p>
      )}

      <div className="grid grid-cols-7 gap-2 mb-5">
        {weekDates.map((d) => {
          const count = apptsByDate[d]?.length ?? 0;
          const isEmpty = count === 0;
          const isToday = d === today;
          const isSelected = d === selected;
          const dow = new Date(d + "T00:00:00").getDay();
          return (
            <button
              key={d}
              onClick={() => setSelected(d)}
              title={
                isEmpty
                  ? "No appointments"
                  : `${count} appointment${count === 1 ? "" : "s"}`
              }
              className={`flex flex-col items-center py-2.5 rounded-md text-sm font-medium transition border ${
                isSelected
                  ? "bg-[oklch(0.18_0.06_260)] text-white border-transparent"
                  : isEmpty
                    ? "bg-secondary/40 text-muted-foreground border-transparent"
                    : "bg-white hover:bg-secondary border"
              } ${isToday && !isSelected ? "ring-2 ring-[oklch(0.55_0.18_245)]" : ""}`}
            >
              <span className="text-[10px] uppercase tracking-wider opacity-70">
                {DAY_LABEL[dow]}
              </span>
              <span>{d.slice(8)}</span>
              {!isEmpty && (
                <span
                  className={`text-[10px] mt-0.5 ${isSelected ? "text-white/80" : "text-muted-foreground"}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold">Appointments · {selected || "—"}</h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
          >
            <Plus size={14} /> New Appointment
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={submit}
            className="p-5 border-b bg-secondary/40 grid grid-cols-1 md:grid-cols-4 gap-3"
          >
            <Field
              label="Patient ID"
              value={draft.patientId}
              onChange={(v) => setDraft({ ...draft, patientId: v })}
              placeholder="e.g. Pat-828"
            />
            <Field
              label="Date"
              type="date"
              value={draft.date}
              onChange={(v) => setDraft({ ...draft, date: v })}
            />
            <Field
              label="Time"
              type="time"
              value={draft.time}
              onChange={(v) => setDraft({ ...draft, time: v })}
            />
            <Field
              label="Type"
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
            />
            <div className="md:col-span-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border px-3 py-1.5 rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save appointment"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Patient ID</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dayAppts.map((a) => {
                const isPending = pendingId === a.docId;
                return (
                  <tr
                    id={`appt-${a.docId}`}
                    key={a.docId}
                    className="border-t hover:bg-secondary/40 transition"
                  >
                    <td className="px-5 py-3.5 font-medium">{a.time}</td>
                    <td className="px-5 py-3.5">{a.patientName}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {a.patientId}
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {actions.map(({ status, icon: Icon, cls }) => {
                          const isCurrent = a.status === status;
                          const isStaged = staged[a.docId] === status;
                          const locked = outcomeLocked(a, status);
                          return (
                            <button
                              key={status}
                              disabled={isPending || locked}
                              onClick={() =>
                                stageStatus(a.docId, status, a.status)
                              }
                              title={
                                locked
                                  ? `Available once the appointment time (${a.time}) has arrived`
                                  : isCurrent
                                    ? `Currently ${status}`
                                    : `Stage: ${status}`
                              }
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed ${
                                isStaged
                                  ? cls +
                                    " ring-2 ring-offset-1 ring-[oklch(0.55_0.18_245)]"
                                  : isCurrent
                                    ? cls + " opacity-60"
                                    : "border bg-white hover:bg-secondary text-foreground"
                              }`}
                            >
                              <Icon size={12} />
                              <span className="hidden xl:inline">{status}</span>
                            </button>
                          );
                        })}
                        {staged[a.docId] && (
                          <button
                            onClick={() => confirmStatus(a.docId)}
                            disabled={isPending}
                            className="text-xs px-2 py-1 rounded-md bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
                          >
                            {isPending
                              ? "Saving…"
                              : `Confirm → ${staged[a.docId]}`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && dayAppts.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-8 text-center text-muted-foreground"
                  >
                    No appointments on this day.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
      />
    </div>
  );
}
