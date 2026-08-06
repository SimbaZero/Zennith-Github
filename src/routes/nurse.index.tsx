import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { fetchDoctorDashboard } from "@/lib/clinic-data";
import { ScanLine, CalendarPlus, Users, Wifi, WifiOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { useHandover, summarizeShift } from "@/lib/handover";
import { useOnline } from "@/lib/offline";
import { getUsername } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/nurse/")({ component: NurseDashboard });

function NurseDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clinician-dashboard"],
    queryFn: fetchDoctorDashboard,
  });
  const today = new Date().toISOString().slice(0, 10);
  const scheduleLabel =
    !data || data.scheduleDate === today ? "Today's Appointments" : `Appointments · ${data.scheduleDate}`;

  return (
    <AppShell role="nurse" title="Nurse Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="APPOINTMENTS"
          value={data ? String(data.stats.dayTotal) : "—"}
          sub={data ? `${data.stats.dayCompleted} completed` : "loading…"}
        />
        <Stat
          label="PATIENTS THIS WEEK"
          value={data ? String(data.stats.weekPatients) : "—"}
          sub="Unique patients, 7 days"
        />
        <Stat
          label="UPCOMING"
          value={data ? String(data.stats.upcoming) : "—"}
          sub="Future appointments"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{scheduleLabel}</h3>
            <button
              onClick={() => navigate({ to: "/nurse/appointments" })}
              className="text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
            >
              Schedule New
            </button>
          </div>
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading appointments…</p>}
            {isError && <p className="text-sm text-destructive py-6 text-center">Could not load appointments.</p>}
            {data?.schedule.map((a) => (
              <div key={a.id} className="flex items-center gap-4 p-3 hover:bg-secondary/50 rounded-md">
                <div className="font-mono text-sm font-semibold w-12">{a.time}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{a.patientName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[a.patientId, a.condition, a.type].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
            {data && data.schedule.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">No appointments found for {data.doctorId}.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link to="/nurse/digitize" className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]">
              <ScanLine size={16} /> Digitize File
            </Link>
            <Link to="/nurse/appointments" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary">
              <CalendarPlus size={16} /> Schedule Appointment
            </Link>
            <Link to="/nurse/patients" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary">
              <Users size={16} /> View Patients
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">THIS WEEK</p>
            <Row label="Patients seen" value={data ? String(data.stats.weekPatients) : "—"} />
            <Row label="Appointments" value={data ? String(data.stats.dayTotal) : "—"} />
            <Row label="Clinician" value={data?.doctorId ?? "—"} />
          </div>
        </div>
      </div>

      <HandoverLog />
    </AppShell>
  );
}

function HandoverLog() {
  const { entries, add, remove } = useHandover();
  const online = useOnline();
  const [shift, setShift] = useState<"Day" | "Night">("Day");
  const [patient, setPatient] = useState("");
  const [note, setNote] = useState("");
  const nurse = getUsername() || "Nurse";
  const summary = summarizeShift(entries, shift);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return toast.error("Add a handover note first");
    add({ nurse, shift, patient: patient.trim() || undefined, note: note.trim() });
    toast.success(online ? "Handover logged" : "Handover saved offline — will sync");
    setPatient("");
    setNote("");
  };

  return (
    <div className="mt-6 bg-white rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold">Shift Handover Log</h3>
          <p className="text-xs text-muted-foreground">{summary.count} entries · {summary.patients} patients this {shift.toLowerCase()} shift</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${online ? "bg-[oklch(0.97_0.06_160)] text-[oklch(0.4_0.15_160)]" : "bg-[oklch(0.97_0.05_60)] text-[oklch(0.45_0.17_60)]"}`}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? "Synced" : "Offline"}
          </span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["Day", "Night"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShift(s)}
                className={`px-3 py-1.5 ${shift === s ? "bg-[oklch(0.18_0.06_260)] text-white" : "hover:bg-secondary"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 mb-4">
        <input
          value={patient}
          onChange={(e) => setPatient(e.target.value)}
          placeholder="Patient (optional)"
          className="px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Handover note (vitals, meds due, follow-up…)"
          className="px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
        />
        <button className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]">
          Log entry
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No handover entries yet.</p>
      ) : (
        <ul className="divide-y">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id} className="py-2.5 flex items-start gap-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground w-16 shrink-0 mt-0.5">
                {new Date(e.ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full border shrink-0 mt-0.5">{e.shift}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{e.patient ?? "General"} · <span className="text-muted-foreground font-normal">{e.nurse}</span></div>
                <div className="text-muted-foreground">{e.note}</div>
              </div>
              <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-[oklch(0.55_0.2_25)]">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
