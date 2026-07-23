import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { appointments } from "@/lib/data";
import { ScanLine, CalendarPlus, Users, Wifi, WifiOff, Trash2, PackageCheck } from "lucide-react";
import { useState } from "react";
import { useHandover, summarizeShift, useRollups } from "@/lib/handover";
import { ShieldCheck } from "lucide-react";
import { useOnline } from "@/lib/offline";
import { getUsername } from "@/lib/auth";
import { toast } from "sonner";
import { useActiveClinic, CLINICS } from "@/lib/clinic";
import { usePending, confirmReceipt } from "@/lib/store";

export const Route = createFileRoute("/nurse/")({ component: NurseDashboard });

function NurseDashboard() {
  const navigate = useNavigate();
  return (
    <AppShell role="nurse" title="Nurse Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="APPOINTMENTS TODAY" value="4" sub="4 scheduled" />
        <Stat label="FILES DIGITIZED" value="12" sub="This week" />
        <Stat label="PENDING FOLLOW-UPS" value="5" sub="To schedule" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Today's Appointments</h3>
            <button
              onClick={() => navigate({ to: "/nurse/appointments" })}
              className="text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
            >
              Schedule New
            </button>
          </div>
          <div className="space-y-2">
            {appointments.slice(0, 4).map((a) => (
              <div key={a.time} className="flex items-center gap-4 p-3 hover:bg-secondary/50 rounded-md">
                <div className="font-mono text-sm font-semibold w-12">{a.time}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{a.patient}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.pid} · {a.note}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
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
            <Row label="Patients registered" value="8" />
            <Row label="Files digitized" value="12" />
            <Row label="Appointments set" value="15" />
          </div>
        </div>
      </div>

      <IncomingStock />
      <HandoverLog />
    </AppShell>
  );
}

function IncomingStock() {
  const clinic = useActiveClinic();
  const pending = usePending().filter((p) => p.clinic === clinic.id);
  const confirm = (id: string, label: string) => {
    if (confirmReceipt(id)) toast.success(`Received ${label} — clinic stock updated`);
  };
  return (
    <div className="mt-6 bg-white rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><PackageCheck size={16} /> Incoming stock — awaiting your receipt</h3>
          <p className="text-xs text-muted-foreground">Distributions sent by the pharmacist to {clinic.name}. Click "Confirm receipt" once you physically verify the delivery.</p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full border bg-secondary/40">{pending.length} pending</span>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending deliveries for {clinic.name}.</p>
      ) : (
        <ul className="divide-y">
          {pending.map((p) => (
            <li key={p.id} className="py-2.5 flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{p.med}</p>
                <p className="text-xs text-muted-foreground">
                  {p.units} units · from {p.from} · {new Date(p.createdAt).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
              <button
                onClick={() => confirm(p.id, `${p.units} × ${p.med}`)}
                className="bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-xs hover:bg-[oklch(0.25_0.08_260)] flex items-center gap-1.5"
              >
                <PackageCheck size={12} /> Confirm receipt
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HandoverLog() {
  const { entries, add, remove, finalizeShift } = useHandover();
  const rollups = useRollups();
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

  const finalize = () => {
    const r = finalizeShift(shift, nurse);
    if (!r) return toast.error(`No ${shift.toLowerCase()}-shift entries to finalize`);
    toast.success(`Shift finalized · ${r.entryCount} entries archived to audit log`);
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

      <div className="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Finalizing packages this shift's notes into a permanent audit rollup.
        </p>
        <button
          onClick={finalize}
          disabled={summary.count === 0}
          className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
        >
          <ShieldCheck size={14} /> Finalize {shift} Shift
        </button>
      </div>

      {rollups.length > 0 && (
        <div className="mt-5 pt-5 border-t">
          <p className="text-[11px] tracking-wider text-muted-foreground mb-2">AUDIT ROLLUPS · IMMUTABLE</p>
          <ul className="space-y-2">
            {rollups.slice(0, 4).map((r) => (
              <li key={r.id} className="text-xs bg-secondary/40 rounded-md p-2.5">
                <div className="flex justify-between">
                  <span className="font-medium">{r.shift} shift · {r.nurse}</span>
                  <span className="text-muted-foreground">
                    {new Date(r.finalizedAt).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {r.entryCount} entries · {r.patientCount} patients
                </div>
              </li>
            ))}
          </ul>
        </div>
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
