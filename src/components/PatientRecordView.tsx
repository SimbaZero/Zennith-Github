import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AppShell } from "@/components/AppShell";
import { patients, currentPatient, patientVisits } from "@/lib/data";
import { Download, ArrowLeft, Printer, Pill, Minus } from "lucide-react";
import type { Role } from "@/lib/auth";
import { useClinicStock, dispenseFromClinic } from "@/lib/store";
import { useActiveClinic } from "@/lib/clinic";
import { toast } from "sonner";

interface PatientRecordViewProps {
  pid: string;
  role: Role;
  backTo: string;
  backLabel: string;
}

/** Shared "PDF themed" patient record view, used by Nurse and Doctor. */
export function PatientRecordView({ pid, role, backTo, backLabel }: PatientRecordViewProps) {
  const navigate = useNavigate();
  const base = patients.find((p) => p.id === pid);
  // Merge with detailed currentPatient when IDs match; otherwise synthesize sensible defaults
  const isCurrent = pid === currentPatient.id;
  const record = {
    id: base?.id ?? pid,
    name: base?.name ?? "Unknown patient",
    condition: base?.condition ?? "—",
    lastVisit: base?.lastVisit ?? "—",
    idNumber: isCurrent ? currentPatient.idNumber : "—",
    cell: isCurrent ? currentPatient.cell : "—",
    age: isCurrent ? currentPatient.age : "—",
    gender: isCurrent ? currentPatient.gender : "—",
    status: isCurrent ? currentPatient.status : "Active",
    medication: isCurrent ? currentPatient.medication : "On standard regimen",
    nextAppointment: isCurrent ? currentPatient.nextAppointment : "—",
    doctor: isCurrent ? currentPatient.doctor : "Dr. Mutizwa",
    visits: isCurrent
      ? patientVisits
      : [{ date: base?.lastVisit ?? "—", doctor: "Dr. Mutizwa", note: "Routine check-up. Vitals stable." }],
  };

  const download = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <AppShell role={role} title={`Medical Record · ${record.id}`}>
      {/* Toolbar (hidden in print) */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <button
          onClick={() => navigate({ to: backTo as any })}
          className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
        >
          <ArrowLeft size={14} /> {backLabel}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
          >
            <Printer size={14} /> Print
          </button>
          <button
            onClick={download}
            className="flex items-center gap-1.5 text-sm bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)]"
          >
            <Download size={14} /> Download PDF
          </button>
        </div>
      </div>

      {/* PDF-themed page */}
      <div
        id="record-page"
        className="mx-auto bg-white text-foreground border shadow-sm print:shadow-none print:border-0"
        style={{ maxWidth: 820, padding: "48px 56px", minHeight: 1100 }}
      >
        {/* Letterhead */}
        <header className="flex items-center justify-between border-b-2 border-[oklch(0.18_0.06_260)] pb-4 mb-6">
          <div className="flex items-center gap-3">
            <ZennithStar size={48} />
            <div>
              <div className="font-bold text-lg leading-tight">Zennith Health Services</div>
              <div className="text-[10px] tracking-[0.2em] text-muted-foreground">HILLBROW COMMUNITY HEALTH CENTRE</div>
            </div>
          </div>
          <div className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Confidential · Medical Record</div>
            <div className="font-mono mt-0.5">Generated {new Date().toLocaleString("en-ZA")}</div>
          </div>
        </header>

        <h1 className="text-2xl font-bold">{record.name}</h1>
        <p className="text-sm text-muted-foreground">Patient ID: {record.id}</p>

        <Section title="Personal Information">
          <Grid>
            <Row label="Full Name" value={record.name} />
            <Row label="Patient ID" value={record.id} />
            <Row label="ID Number" value={record.idNumber} />
            <Row label="Age / Gender" value={`${record.age} / ${record.gender}`} />
            <Row label="Cell Phone" value={record.cell} />
            <Row label="Status" value={record.status} />
          </Grid>
        </Section>

        <Section title="Medical History">
          <Grid>
            <Row label="Primary Condition" value={record.condition} />
            <Row label="Current Medication" value={record.medication} />
            <Row label="Treating Doctor" value={record.doctor} />
            <Row label="Last Visit" value={record.lastVisit} />
            <Row label="Next Appointment" value={record.nextAppointment} />
          </Grid>
        </Section>

        <Section title="Visit History">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Doctor</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {record.visits.map((v, i) => (
                <tr key={i} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-mono text-xs">{v.date}</td>
                  <td className="py-2 pr-3">{v.doctor}</td>
                  <td className="py-2">{v.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <footer className="mt-8 pt-4 border-t text-[10px] text-muted-foreground flex justify-between">
          <span>Zennith Health Services · Auto-generated medical record</span>
          <span>Page 1 of 1</span>
        </footer>

        <div className="mt-2 text-[10px] text-muted-foreground print:hidden">
          <Link to={backTo as any} className="text-[oklch(0.55_0.18_245)] hover:underline">← Back to patient files</Link>
        </div>
      </div>

      {(role === "nurse" || role === "doctor") && (
        <DispensePanel patientName={record.name} />
      )}
    </AppShell>
  );
}

function DispensePanel({ patientName }: { patientName: string }) {
  const clinic = useActiveClinic();
  const stock = useClinicStock(clinic.id);
  const [med, setMed] = useState<string>(stock[0]?.name ?? "");
  const [qty, setQty] = useState(1);
  const current = useMemo(() => stock.find((s) => s.name === med), [stock, med]);

  const submit = () => {
    if (!med || qty <= 0) return;
    const ok = dispenseFromClinic(med, clinic.id, qty);
    if (ok) toast.success(`Dispensed ${qty} × ${med} to ${patientName}`);
    else toast.error(`Not enough stock at ${clinic.name}`);
  };

  return (
    <section className="mt-6 max-w-[820px] mx-auto bg-white border rounded-xl p-5 print:hidden">
      <div className="flex items-center gap-2 mb-3">
        <Pill size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Dispense medication</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">Active clinic: <strong className="text-foreground">{clinic.name}</strong></span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-3 items-end">
        <div>
          <label className="text-[10px] tracking-wider text-muted-foreground uppercase block mb-1">Medication</label>
          <select value={med} onChange={(e) => { setMed(e.target.value); setQty(1); }} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
            {stock.map((s) => (
              <option key={s.name} value={s.name}>{s.name} — {s.units} on hand</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] tracking-wider text-muted-foreground uppercase block mb-1">Qty</label>
          <input type="number" min={1} max={current?.units ?? 1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-full border rounded-md px-3 py-2 text-sm" />
        </div>
        <button onClick={submit} disabled={!current || current.units < qty} className="inline-flex items-center gap-1.5 bg-[oklch(0.55_0.2_25)] disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.5_0.2_25)]">
          <Minus size={14} /> Dispense
        </button>
      </div>
      {current && current.units <= current.threshold && (
        <p className="text-xs text-[oklch(0.5_0.2_25)] mt-2">Low stock at {clinic.name} — pharmacist alerted.</p>
      )}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="text-xs font-semibold tracking-[0.2em] text-[oklch(0.18_0.06_260)] border-b pb-1 mb-3">
        {title.toUpperCase()}
      </h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">{children}</div>;
}
function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex">
      <div className="w-40 text-muted-foreground text-xs uppercase tracking-wider self-end pb-0.5">{label}</div>
      <div className="flex-1 font-medium border-b border-dotted border-muted-foreground/40 pb-0.5">{value}</div>
    </div>
  );
}

// Shared component only — routes are defined in src/routes/nurse.patient-record.$pid.tsx and src/routes/doctor.patient-record.$pid.tsx

