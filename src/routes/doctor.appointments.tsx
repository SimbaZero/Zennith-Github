import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, StatusBadge, type AppointmentStatus } from "@/components/AppShell";
import { useDoctorWeekSchedule, useCurrentDoctor } from "@/lib/doctor-service";
import { setAppointmentStatus, createAppointment } from "@/lib/clinic-data";
import { Plus, Check, Clock, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/doctor/appointments")({
  validateSearch: (s: Record<string, unknown>): { date?: string } =>
    typeof s.date === "string" ? { date: s.date } : {},
  component: DoctorAppointments,
});

function DoctorAppointments() {
  const { date: searchDate } = Route.useSearch();
  const { doctor } = useCurrentDoctor();
  const { dates, apptsByDate, loading, error } = useDoctorWeekSchedule();

  const today = new Date().toISOString().slice(0, 10);
  const [picked, setPicked] = useState<string | null>(null);

  // Only honour the search-param date if it falls within this week —
  // the page is locked to the current week, so anything outside it falls
  // back to today (or the first day of the week).
  const searchDateInWeek = searchDate && dates.includes(searchDate) ? searchDate : null;
  const day = picked ?? searchDateInWeek ?? (dates.includes(today) ? today : dates[0] ?? "");
  const dayAppts = apptsByDate[day] ?? [];

  // Per-row pending state so a status click gives instant feedback — the
  // actual list update comes from the live Firestore listener, not from
  // this flag, but this stops the buttons from looking unresponsive while
  // the write is in flight.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const changeStatus = async (docId: string, status: AppointmentStatus) => {
    setPendingId(docId);
    try {
      await setAppointmentStatus(docId, status);
      toast.success(`Marked as ${status}`);
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
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    type: "Follow-up",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim()) return toast.error("Patient ID is required (e.g. Pat-828)");
    if (!draft.date || !draft.time) return toast.error("Date and time are required");

    setSaving(true);
    try {
      await createAppointment({ ...draft, clinician: doctor?.doctorId });
      toast.success(`Appointment booked for ${draft.patientId} on ${draft.date} at ${draft.time}`);
      setDraft({ ...draft, patientId: "" });
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not book appointment");
    } finally {
      setSaving(false);
    }
  };

  const actions: { status: AppointmentStatus; icon: any; cls: string }[] = [
    { status: "Complete",    icon: Check,       cls: "bg-[oklch(0.55_0.18_150)] text-white" },
    { status: "In-progress", icon: Clock,       cls: "bg-[oklch(0.6_0.16_165)] text-white" },
    { status: "Incomplete",  icon: AlertCircle, cls: "bg-[oklch(0.78_0.17_85)] text-[oklch(0.25_0.08_70)]" },
    { status: "No-show",     icon: X,           cls: "bg-[oklch(0.55_0.22_25)] text-white" },
  ];

  return (
    <AppShell role="doctor" title="Patient Appointments">
      <div className="flex flex-wrap gap-2 mb-5">
        {loading && <p className="text-sm text-muted-foreground">Loading appointments…</p>}
        {dates.map((d) => (
          <button
            key={d}
            onClick={() => setPicked(d)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              d === day ? "bg-[oklch(0.18_0.06_260)] text-white" : "bg-white border hover:bg-secondary"
            }`}
          >
            {d === today ? "Today" : d}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold">Appointments · {day || "—"}</h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
          >
            <Plus size={14} /> New Appointment
          </button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="p-5 border-b bg-secondary/40 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Patient ID" value={draft.patientId} onChange={(v) => setDraft({ ...draft, patientId: v })} placeholder="e.g. Pat-828" />
            <Field label="Date" type="date" value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
            <Field label="Time" type="time" value={draft.time} onChange={(v) => setDraft({ ...draft, time: v })} />
            <Field label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} />
            <div className="md:col-span-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="border px-3 py-1.5 rounded-md text-sm">Cancel</button>
              <button type="submit" disabled={saving} className="bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-60">
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
                  <tr id={`appt-${a.docId}`} key={a.docId} className="border-t hover:bg-secondary/40 transition">
                    <td className="px-5 py-3.5 font-medium">{a.time}</td>
                    <td className="px-5 py-3.5">{a.patientName}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{a.patientId}</td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={a.status} /></td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {actions.map(({ status, icon: Icon, cls }) => {
                          const active = a.status === status;
                          return (
                            <button
                              key={status}
                              disabled={isPending}
                              onClick={() => changeStatus(a.docId, status)}
                              title={status}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition disabled:opacity-50 ${active ? cls + " ring-2 ring-offset-1 ring-foreground/20" : "border bg-white hover:bg-secondary text-foreground"}`}
                            >
                              <Icon size={12} />
                              <span className="hidden xl:inline">{status}</span>
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && dayAppts.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No appointments on this day.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">{label}</label>
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