import { Link, useNavigate } from "@tanstack/react-router";
import { ZennithStar } from "@/components/ZennithStar";
import { AppShell } from "@/components/AppShell";
import { usePatientRecord } from "@/lib/doctor-service";
import { Download, ArrowLeft, Printer } from "lucide-react";
import type { Role } from "@/lib/auth";

interface PatientRecordViewProps {
  pid: string;
  role: Role;
  backTo: string;
  backLabel: string;
}

/** Shared "PDF themed" patient record view, used by Nurse and Doctor. */
export function PatientRecordView({ pid, role, backTo, backLabel }: PatientRecordViewProps) {
  const navigate = useNavigate();
  const { record, loading, error } = usePatientRecord(pid);

  const download = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <AppShell role={role} title={`Medical Record · ${pid}`}>
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

      {loading && (
        <p className="text-sm text-muted-foreground py-10 text-center">Loading medical record…</p>
      )}
      {error && (
        <p className="text-sm text-destructive py-10 text-center">
          {error === `Patient "${pid}" not found` ? error : `Could not load a medical record for "${pid}".`}
        </p>
      )}

      {record && (
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
          <p className="text-sm text-muted-foreground">Patient ID: {record.patientId}</p>

          <Section title="Personal Information">
            <Grid>
              <Row label="Full Name" value={record.name} />
              <Row label="Patient ID" value={record.patientId} />
              <Row label="ID Number" value={record.idNumber} />
              <Row label="Cell Phone" value={record.cell} />
              <Row label="Email" value={record.email} />
              <Row label="Address" value={record.address} />
              <Row label="Emergency Contact" value={record.emergencyContactName} />
              <Row label="Emergency Phone" value={record.emergencyContactNo} />
            </Grid>
          </Section>

          <Section title="Medical History">
            <Grid>
              <Row label="Primary Condition" value={record.condition} />
              <Row label="Blood Type" value={record.bloodType} />
              <Row label="Allergies" value={record.allergies} />
              <Row label="Prescription" value={record.prescription} />
              <Row label="Dosage" value={record.dosage} />
              <Row label="Blood Pressure" value={record.bp} />
              <Row label="Glucose" value={record.glucose} />
              <Row label="CD4 Count" value={record.cd4} />
              <Row label="Viral Load" value={record.viralLoad} />
              <Row label="Insurance" value={record.insurance} />
              <Row label="Last Visit" value={record.lastVisit} />
              <Row label="Next Appointment" value={record.nextAppointment} />
            </Grid>
          </Section>

          <Section title="Clinical Notes">
            {record.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clinical notes on file.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {record.history.map((h) => (
                  <li key={h.id} className="border-b border-dotted border-muted-foreground/30 pb-2 last:border-0">
                    {h.description}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <footer className="mt-8 pt-4 border-t text-[10px] text-muted-foreground flex justify-between">
            <span>Zennith Health Services · Auto-generated medical record</span>
            <span>Page 1 of 1</span>
          </footer>

          <div className="mt-2 text-[10px] text-muted-foreground print:hidden">
            <Link to={backTo as any} className="text-[oklch(0.55_0.18_245)] hover:underline">← Back to patient files</Link>
          </div>
        </div>
      )}
    </AppShell>
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