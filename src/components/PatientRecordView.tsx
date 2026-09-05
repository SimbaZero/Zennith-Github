import { Link, useNavigate } from "@tanstack/react-router";
import { ZennithStar } from "@/components/ZennithStar";
import { AppShell } from "@/components/AppShell";
import { usePatientRecord } from "@/lib/doctor-service";
import { updatePatient, updateMedicalRecord } from "@/lib/clinic-data";
import { useClinicInventory, dispenseMedication } from "@/lib/nurse-service";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Download,
  ArrowLeft,
  Printer,
  Pencil,
  Check,
  X,
  Plus,
  Syringe,
} from "lucide-react";
import { generatePatientRecordPdf } from "@/lib/pdf-export";
import { useState } from "react";
import { toast } from "sonner";
import type { Role } from "@/lib/auth";

interface PatientRecordViewProps {
  pid: string;
  role: Role;
  backTo: string;
  backLabel: string;
  /** When true (Nurse only, currently), shows Edit Record — identity/
   *  registration fields stay locked regardless. */
  editable?: boolean;
  /** Needed for the Dispense Medication panel (Nurse only) — which clinic's
   *  inventory to draw from, and who dispensed it. Omit to hide the panel
   *  entirely (e.g. on the Doctor view). */
  clinicId?: number;
  nurseId?: string;
  /** Real clinic name from Firestore (nurses/doctors resolve it from
   *  clinics/{clinicId}). Passed straight to AppShell — without it the header
   *  falls back to the fake localStorage clinic switcher in lib/clinic.ts. */
  clinicName?: string | null;
}

interface EditableFields {
  condition: string;
  bloodType: string;
  allergies: string;
  prescription: string;
  dosage: string;
  bp: string;
  glucose: string;
  cd4: string;
  viralLoad: string;
}

const PLACEHOLDER_VALUES = new Set(["—", "None recorded", "None"]);
const clean = (v: string) => (PLACEHOLDER_VALUES.has(v) ? "" : v);

/** Shared "PDF themed" patient record view, used by Nurse and Doctor. */
export function PatientRecordView({
  pid,
  role,
  backTo,
  backLabel,
  editable,
  clinicId,
  nurseId,
  clinicName,
}: PatientRecordViewProps) {
  const navigate = useNavigate();
  const { record, medicalRecordNo, loading, error } = usePatientRecord(pid);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditableFields | null>(null);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // --- Dispense Medication ---
  const { items: inventory, loading: inventoryLoading } =
    useClinicInventory(clinicId);
  // Opens automatically when arriving via a "Dispense" link (e.g. from the
  // Patients list) with ?dispense=1 in the URL — one click gets a nurse
  // straight into the panel instead of View -> then find the button.
  const [dispensing, setDispensing] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("dispense") === "1";
  });
  const [dispenseMed, setDispenseMed] = useState("");
  const [dispenseQty, setDispenseQty] = useState("1");
  const [dispenseNote, setDispenseNote] = useState("");
  const [dispenseSaving, setDispenseSaving] = useState(false);

  const download = () => {
    if (!record) return;
    generatePatientRecordPdf(record);
  };

  const beginEdit = () => {
    if (!record) return;
    setForm({
      condition: clean(record.condition),
      bloodType: clean(record.bloodType),
      allergies: clean(record.allergies),
      prescription: clean(record.prescription),
      dosage: clean(record.dosage),
      bp: clean(record.bp),
      glucose: clean(record.glucose),
      cd4: clean(record.cd4),
      viralLoad: clean(record.viralLoad),
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
  };

  const setField = (field: keyof EditableFields, value: string) => {
    setForm((f) => (f ? { ...f, [field]: value } : f));
  };

  const saveEdit = async () => {
    if (!form || !record) return;
    setSaving(true);
    try {
      await Promise.all([
        updatePatient(record.patientId, {
          chronicCondition: form.condition || undefined,
        }),
        medicalRecordNo != null
          ? updateMedicalRecord(medicalRecordNo, {
              bloodType: form.bloodType || undefined,
              allergies: form.allergies || undefined,
              prescription: form.prescription || undefined,
              dosage: form.dosage ? Number(form.dosage) : undefined,
              bp: form.bp || undefined,
              glucose: form.glucose ? Number(form.glucose) : undefined,
              cd4: form.cd4 ? Number(form.cd4) : undefined,
              viralLoad: form.viralLoad ? Number(form.viralLoad) : undefined,
              // Editing the chart is a real checkup interaction — counts as a visit.
              lastVisit: new Date().toISOString().slice(0, 10),
            } as any)
          : Promise.resolve(),
      ]);
      toast.success("Medical record updated");
      setEditing(false);
      setForm(null);
    } catch (err) {
      console.error("Failed to save medical record:", err);
      toast.error("Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!noteText.trim() || !record || medicalRecordNo == null) return;
    setAddingNote(true);
    try {
      await addDoc(collection(db, "medicalRecordsHistory"), {
        historyId: Date.now(),
        medicalRecordNo,
        patientId: record.patientId,
        description: noteText.trim(),
        visitDate: new Date().toISOString().slice(0, 10),
      });
      setNoteText("");
    } catch (err) {
      console.error("Failed to add note:", err);
      toast.error("Could not add note");
    } finally {
      setAddingNote(false);
    }
  };

  const confirmDispense = async () => {
    if (!record || !nurseId || clinicId == null) return;
    const med = inventory.find((i) => i.medName === dispenseMed);
    if (!med) return toast.error("Pick a medication");
    const qty = Number(dispenseQty);
    if (!qty || qty <= 0) return toast.error("Enter a valid quantity");
    if (qty > med.quantity)
      return toast.error(
        `Only ${med.quantity} unit${med.quantity === 1 ? "" : "s"} in stock`,
      );

    setDispenseSaving(true);
    try {
      await dispenseMedication({
        patientId: record.patientId,
        clinicId,
        inventId: med.inventId,
        medName: med.medName,
        unitsGiven: qty,
        nurseId,
        note: dispenseNote.trim() || undefined,
        medicalRecordNo: medicalRecordNo ?? undefined,
      });
      toast.success(`Dispensed ${qty}× ${med.medName} to ${record.patientId}`);
      setDispensing(false);
      setDispenseMed("");
      setDispenseQty("1");
      setDispenseNote("");
    } catch (err) {
      console.error("Failed to dispense medication:", err);
      toast.error(
        err instanceof Error ? err.message : "Could not dispense medication",
      );
    } finally {
      setDispenseSaving(false);
    }
  };

  return (
    <AppShell
      role={role}
      title={`Medical Record · ${pid}`}
      clinicNameOverride={clinicName}
    >
      {/* Toolbar (hidden in print) */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <button
          onClick={() => navigate({ to: backTo as any })}
          className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
        >
          <ArrowLeft size={14} /> {backLabel}
        </button>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary disabled:opacity-60"
              >
                <X size={14} /> Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
              >
                <Check size={14} /> {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          ) : (
            <>
              {editable && record && clinicId != null && (
                <button
                  onClick={() => setDispensing((v) => !v)}
                  className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
                >
                  <Syringe size={14} /> Dispense Medication
                </button>
              )}
              {editable && record && (
                <button
                  onClick={beginEdit}
                  className="flex items-center gap-1.5 text-sm border px-3 py-1.5 rounded-md hover:bg-secondary"
                >
                  <Pencil size={14} /> Edit Record
                </button>
              )}
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
            </>
          )}
        </div>
      </div>

      {dispensing && record && (
        <div
          className="mx-auto mb-4 bg-white border rounded-xl p-5 print:hidden"
          style={{ maxWidth: 820 }}
        >
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Syringe size={16} /> Dispense Medication — {record.patientId}
          </h3>
          {inventoryLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading available stock…
            </p>
          ) : inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No medication with available stock at this clinic.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
                  Medication
                </label>
                <select
                  value={dispenseMed}
                  onChange={(e) => setDispenseMed(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
                >
                  <option value="">Select…</option>
                  {inventory.map((i) => (
                    <option key={i.docId} value={i.medName}>
                      {i.medName} — {i.quantity} in stock
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
                  Units
                </label>
                <input
                  type="number"
                  min={1}
                  value={dispenseQty}
                  onChange={(e) => setDispenseQty(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDispensing(false)}
                  className="border px-3 py-2 rounded-md text-sm hover:bg-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDispense}
                  disabled={dispenseSaving || !dispenseMed}
                  className="flex-1 bg-[oklch(0.18_0.06_260)] text-white px-3 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
                >
                  {dispenseSaving ? "Recording…" : "Confirm"}
                </button>
              </div>
              <div className="md:col-span-4">
                <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
                  Note (optional — e.g. scheduled appointment, acute/walk-in)
                </label>
                <input
                  value={dispenseNote}
                  onChange={(e) => setDispenseNote(e.target.value)}
                  placeholder="Context for this dispense…"
                  className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Loading medical record…
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive py-10 text-center">
          {error === `Patient "${pid}" not found`
            ? error
            : `Could not load a medical record for "${pid}".`}
        </p>
      )}

      {record && (
        <div
          id="record-page"
          className="mx-auto bg-white text-foreground border shadow-sm print:shadow-none print:border-0"
          style={{ maxWidth: 820, padding: "48px 56px", minHeight: 1100 }}
        >
          <header className="flex items-center justify-between border-b-2 border-[oklch(0.18_0.06_260)] pb-4 mb-6">
            <div className="flex items-center gap-3">
              <ZennithStar size={48} />
              <div>
                <div className="font-bold text-lg leading-tight">
                  Zennith Health Services
                </div>
                <div className="text-[10px] tracking-[0.2em] text-muted-foreground">
                  HILLBROW COMMUNITY HEALTH CENTRE
                </div>
              </div>
            </div>
            <div className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>Confidential · Medical Record</div>
              <div className="font-mono mt-0.5">
                Generated {new Date().toLocaleString("en-ZA")}
              </div>
            </div>
          </header>

          <h1 className="text-2xl font-bold">{record.name}</h1>
          <p className="text-sm text-muted-foreground">
            Patient ID: {record.patientId}
          </p>

          <Section title="Personal Information">
            <Grid>
              <Row label="Full Name" value={record.name} />
              <Row label="Patient ID" value={record.patientId} />
              <Row label="ID Number" value={record.idNumber} />
              <Row label="Cell Phone" value={record.cell} />
              <Row label="Email" value={record.email} />
              <Row label="Address" value={record.address} />
              <Row
                label="Emergency Contact"
                value={record.emergencyContactName}
              />
              <Row label="Emergency Phone" value={record.emergencyContactNo} />
            </Grid>
          </Section>

          <Section title="Medical History">
            <Grid>
              {editing && form ? (
                <>
                  <EditRow
                    label="Primary Condition"
                    value={form.condition}
                    onChange={(v) => setField("condition", v)}
                  />
                  <EditRow
                    label="Blood Type"
                    value={form.bloodType}
                    onChange={(v) => setField("bloodType", v)}
                  />
                  <EditRow
                    label="Allergies"
                    value={form.allergies}
                    onChange={(v) => setField("allergies", v)}
                  />
                  <EditRow
                    label="Prescription"
                    value={form.prescription}
                    onChange={(v) => setField("prescription", v)}
                  />
                  <EditRow
                    label="Dosage"
                    value={form.dosage}
                    onChange={(v) => setField("dosage", v)}
                    type="number"
                  />
                  <EditRow
                    label="Blood Pressure"
                    value={form.bp}
                    onChange={(v) => setField("bp", v)}
                  />
                  <EditRow
                    label="Glucose"
                    value={form.glucose}
                    onChange={(v) => setField("glucose", v)}
                    type="number"
                  />
                  <EditRow
                    label="CD4 Count"
                    value={form.cd4}
                    onChange={(v) => setField("cd4", v)}
                    type="number"
                  />
                  <EditRow
                    label="Viral Load"
                    value={form.viralLoad}
                    onChange={(v) => setField("viralLoad", v)}
                    type="number"
                  />
                  <Row label="Insurance" value={record.insurance} />
                  <Row label="Last Visit" value={record.lastVisit} />
                  <Row
                    label="Next Appointment"
                    value={record.nextAppointment}
                  />
                </>
              ) : (
                <>
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
                  <Row
                    label="Next Appointment"
                    value={record.nextAppointment}
                  />
                </>
              )}
            </Grid>
          </Section>

          <Section title="Clinical Notes">
            {record.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No clinical notes on file.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {record.history.map((h) => (
                  <li
                    key={h.id}
                    className="border-b border-dotted border-muted-foreground/30 pb-2 last:border-0"
                  >
                    {h.description}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <div className="flex gap-2 mt-3 print:hidden">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a clinical note…"
                  className="flex-1 px-2 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
                />
                <button
                  onClick={addNote}
                  disabled={addingNote || !noteText.trim()}
                  className="flex items-center gap-1 border px-3 py-1.5 rounded-md text-sm hover:bg-secondary disabled:opacity-60"
                >
                  <Plus size={14} /> {addingNote ? "Adding…" : "Add"}
                </button>
              </div>
            )}
          </Section>

          <footer className="mt-8 pt-4 border-t text-[10px] text-muted-foreground flex justify-between">
            <span>Zennith Health Services · Auto-generated medical record</span>
            <span>Page 1 of 1</span>
          </footer>

          <div className="mt-2 text-[10px] text-muted-foreground print:hidden">
            <Link
              to={backTo as any}
              className="text-[oklch(0.55_0.18_245)] hover:underline"
            >
              ← Back to patient files
            </Link>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
  return (
    <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">{children}</div>
  );
}
function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex">
      <div className="w-40 text-muted-foreground text-xs uppercase tracking-wider self-end pb-0.5">
        {label}
      </div>
      <div className="flex-1 font-medium border-b border-dotted border-muted-foreground/40 pb-0.5">
        {value}
      </div>
    </div>
  );
}
function EditRow({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
}) {
  return (
    <div className="flex items-center print:hidden">
      <div className="w-40 text-muted-foreground text-xs uppercase tracking-wider">
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 font-medium border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
      />
    </div>
  );
}

// Shared component only — routes are defined in src/routes/nurse.patient-record.$pid.tsx and src/routes/doctor.patient-record.$pid.tsx
