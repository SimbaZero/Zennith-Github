import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, StatusBadge, type AppointmentStatus } from "@/components/AppShell";
import {
  useAppointments,
  useNow,
  computeEffective,
  setAppointmentStatus,
  addAppointment,
  highRiskPatients,
} from "@/lib/store";
import { Plus, Check, Clock, X, AlertCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/doctor/appointments")({ component: DoctorAppointments });

function DoctorAppointments() {
  const rows = useAppointments();
  const now = useNow(15_000);
  const effective = useMemo(() => computeEffective(rows, now), [rows, now]);
  const risky = useMemo(() => highRiskPatients(effective), [effective]);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    time: "09:00",
    patient: "",
    doctor: "Dr. Mutizwa",
    type: "Follow-up",
    pid: "",
    note: "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patient.trim()) return toast.error("Patient name is required");
    addAppointment({
      ...draft,
      pid: draft.pid || `P-${Math.floor(1000 + Math.random() * 8999)}`,
      status: "Incomplete",
    });
    toast.success(`Appointment booked for ${draft.patient} at ${draft.time}`);
    setDraft({ ...draft, patient: "", pid: "", note: "" });
    setShowForm(false);
  };

  const actions: { status: AppointmentStatus; icon: any; cls: string }[] = [
    { status: "Complete",    icon: Check,       cls: "bg-[oklch(0.55_0.18_150)] text-white" },
    { status: "In-progress", icon: Clock,       cls: "bg-[oklch(0.6_0.16_165)] text-white" },
    { status: "Incomplete",  icon: AlertCircle, cls: "bg-[oklch(0.78_0.17_85)] text-[oklch(0.25_0.08_70)]" },
    { status: "No-show",     icon: X,           cls: "bg-[oklch(0.55_0.22_25)] text-white" },
  ];

  return (
    <AppShell role="doctor" title="Patient Appointments">
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold">All Appointments</h3>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
          >
            <Plus size={14} /> New Appointment
          </button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="p-5 border-b bg-secondary/40 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Patient name" value={draft.patient} onChange={(v) => setDraft({ ...draft, patient: v })} />
            <Field label="Patient ID" value={draft.pid} onChange={(v) => setDraft({ ...draft, pid: v })} placeholder="auto" />
            <Field label="Time" type="time" value={draft.time} onChange={(v) => setDraft({ ...draft, time: v })} />
            <Field label="Doctor" value={draft.doctor} onChange={(v) => setDraft({ ...draft, doctor: v })} />
            <Field label="Type" value={draft.type} onChange={(v) => setDraft({ ...draft, type: v })} />
            <Field label="Note" value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} />
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="border px-3 py-1.5 rounded-md text-sm">Cancel</button>
              <button type="submit" className="bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm">Save appointment</button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Doctor</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {effective.map((a) => (
                <tr id={`appt-${encodeURIComponent(a.time)}-${encodeURIComponent(a.patient)}`} key={`${a.time}-${a.patient}`} className="border-t hover:bg-secondary/40 transition">
                  <td className="px-5 py-3.5 font-medium">{a.time}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5">
                      {a.patient}
                      {risky.has(a.patient) && (
                        <span title="Missed 2+ appointments" className="inline-flex items-center gap-1 text-[10px] tracking-wider px-1.5 py-0.5 rounded-full border bg-[oklch(0.97_0.05_25)] text-[oklch(0.5_0.2_25)] border-[oklch(0.85_0.12_25)]">
                          <ShieldAlert size={10} /> HIGH RISK
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">{a.doctor}</td>
                  <td className="px-5 py-3.5">{a.type}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={a.status} /></td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map(({ status, icon: Icon, cls }) => {
                        const active = a.status === status;
                        return (
                          <button
                            key={status}
                            onClick={() => {
                              setAppointmentStatus(a.time, a.patient, status);
                              toast.success(`Marked as ${status}`);
                            }}
                            title={status}
                            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition ${active ? cls + " ring-2 ring-offset-1 ring-foreground/20" : "border bg-white hover:bg-secondary text-foreground"}`}
                          >
                            <Icon size={12} />
                            <span className="hidden xl:inline">{status}</span>
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
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
