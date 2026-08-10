import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft, Save, Pencil, X, Loader2 } from "lucide-react";
import { getDoc, doc } from "firebase/firestore";
import { db } from "@/firebase";

import {
  fetchPatientRecord,
  updatePatient,
  updateUser,
  updateMedicalRecord,
} from "@/lib/clinic-data";

export const Route = createFileRoute("/receptionist/profiles_/$pid")({
  component: PatientDetail,
});

function PatientDetail() {
  const { pid } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const {
    data: record,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["patient-record", pid],
    queryFn: () => fetchPatientRecord(pid),
  });

  // Form state for editing
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (record) {
      setForm({
        name: record.name,
        idNumber: record.idNumber,
        cell: record.cell,
        address: record.address,
        email: record.email,
        condition: record.condition,
        emergencyContactName: record.emergencyContactName,
        emergencyContactNo: record.emergencyContactNo,
        bloodType: record.bloodType,
        allergies: record.allergies,
        prescription: record.prescription,
        dosage: record.dosage,
        bp: record.bp,
        glucose: record.glucose,
        cd4: record.cd4,
        viralLoad: record.viralLoad,
        insurance: record.insurance,
        lastVisit: record.lastVisit,
        nextAppointment: record.nextAppointment,
      });
    }
  }, [record]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!record) throw new Error("No record loaded");

      // Parse name into first/surname
      const parts = form.name.trim().split(/\s+/);
      const names = parts[0] || "";
      const surname = parts.slice(1).join(" ");

      // Fetch patient doc directly using imported db
      const patientSnap = await getDoc(doc(db, "patients", pid));
      if (!patientSnap.exists()) throw new Error("Patient not found");

      const patientData = patientSnap.data();
      const userId = patientData.userId;
      const recordNo = patientData.medicalRecordNo;

      // Update all three collections
      await Promise.all([
        updateUser(userId, {
          names,
          surname,
          idNumber: form.idNumber,
          contactNum: form.cell,
          email: form.email,
        }),
        updatePatient(pid, {
          chronicCondition: form.condition,
          emergencyContactName: form.emergencyContactName,
          emergencyContactNo: form.emergencyContactNo,
        }),
        updateMedicalRecord(recordNo, {
          bloodType: form.bloodType,
          allergies: form.allergies,
          prescription: form.prescription,
          dosage: form.dosage !== "—" ? Number(form.dosage) : undefined,
          bp: form.bp,
          glucose: form.glucose !== "—" ? Number(form.glucose) : undefined,
          cd4: form.cd4 !== "—" ? Number(form.cd4) : undefined,
          viralLoad:
            form.viralLoad !== "—" ? Number(form.viralLoad) : undefined,
          // Fixed Error 2: fallback to undefined instead of null
          insurancePolicyNumber:
            form.insurance !== "None" ? form.insurance : undefined,
        }),
      ]);
    },
    onSuccess: () => {
      toast.success("Patient profile updated");
      queryClient.invalidateQueries({ queryKey: ["patient-record", pid] });
      queryClient.invalidateQueries({ queryKey: ["patient-page"] });
      setEditing(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Update failed");
    },
  });

  const setField = (key: string) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <AppShell role="receptionist" title="Patient Profile">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (isError || !record) {
    return (
      <AppShell role="receptionist" title="Patient Profile">
        <div className="p-8 text-center">
          <p className="text-destructive mb-4">
            Failed to load patient record.
          </p>
          <button
            onClick={() => navigate({ to: "/receptionist/profiles" })}
            className="border px-4 py-2 rounded-md text-sm hover:bg-secondary"
          >
            ← Back to Profiles
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell role="receptionist" title={`Patient Profile — ${record.name}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate({ to: "/receptionist/profiles" })}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back to Profiles
        </button>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => {
                  setEditing(false);
                  // Reset form
                  if (record) {
                    setForm({
                      name: record.name,
                      idNumber: record.idNumber,
                      cell: record.cell,
                      address: record.address,
                      email: record.email,
                      condition: record.condition,
                      emergencyContactName: record.emergencyContactName,
                      emergencyContactNo: record.emergencyContactNo,
                      bloodType: record.bloodType,
                      allergies: record.allergies,
                      prescription: record.prescription,
                      dosage: record.dosage,
                      bp: record.bp,
                      glucose: record.glucose,
                      cd4: record.cd4,
                      viralLoad: record.viralLoad,
                      insurance: record.insurance,
                      lastVisit: record.lastVisit,
                      nextAppointment: record.nextAppointment,
                    });
                  }
                }}
                className="flex items-center gap-1.5 border px-3 py-1.5 rounded-md text-sm hover:bg-secondary"
              >
                <X size={14} /> Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="flex items-center gap-1.5 bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.5_0.18_245)] disabled:opacity-60"
              >
                {updateMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 border px-3 py-1.5 rounded-md text-sm hover:bg-secondary"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Patient Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Demographics */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              DEMOGRAPHICS
            </h3>
            <div className="space-y-3">
              <FieldRow label="Patient ID" value={pid} disabled />
              <FieldRow
                label="Full Name"
                value={form.name}
                editing={editing}
                onChange={setField("name")}
              />
              <FieldRow
                label="ID Number"
                value={form.idNumber}
                editing={editing}
                onChange={setField("idNumber")}
              />
              <FieldRow
                label="Cell"
                value={form.cell}
                editing={editing}
                onChange={setField("cell")}
              />
              <FieldRow
                label="Email"
                value={form.email}
                editing={editing}
                onChange={setField("email")}
              />
              <FieldRow
                label="Address"
                value={form.address}
                editing={editing}
                onChange={setField("address")}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              EMERGENCY CONTACT
            </h3>
            <div className="space-y-3">
              <FieldRow
                label="Name"
                value={form.emergencyContactName}
                editing={editing}
                onChange={setField("emergencyContactName")}
              />
              <FieldRow
                label="Phone"
                value={form.emergencyContactNo}
                editing={editing}
                onChange={setField("emergencyContactNo")}
              />
            </div>
          </div>
        </div>

        {/* Middle column — Medical */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              MEDICAL INFORMATION
            </h3>
            <div className="space-y-3">
              <FieldRow
                label="Chronic Condition"
                value={form.condition}
                editing={editing}
                onChange={setField("condition")}
              />
              <FieldRow
                label="Blood Type"
                value={form.bloodType}
                editing={editing}
                onChange={setField("bloodType")}
              />
              <FieldRow
                label="Allergies"
                value={form.allergies}
                editing={editing}
                onChange={setField("allergies")}
              />
              <FieldRow
                label="Prescription"
                value={form.prescription}
                editing={editing}
                onChange={setField("prescription")}
              />
              <FieldRow
                label="Dosage"
                value={form.dosage}
                editing={editing}
                onChange={setField("dosage")}
              />
              <FieldRow
                label="Blood Pressure"
                value={form.bp}
                editing={editing}
                onChange={setField("bp")}
              />
              <FieldRow
                label="Glucose"
                value={form.glucose}
                editing={editing}
                onChange={setField("glucose")}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              LAB VALUES
            </h3>
            <div className="space-y-3">
              <FieldRow
                label="CD4 Count"
                value={form.cd4}
                editing={editing}
                onChange={setField("cd4")}
              />
              <FieldRow
                label="Viral Load"
                value={form.viralLoad}
                editing={editing}
                onChange={setField("viralLoad")}
              />
            </div>
          </div>
        </div>

        {/* Right column — Insurance + History */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              INSURANCE
            </h3>
            <div className="space-y-3">
              <FieldRow
                label="Policy"
                value={form.insurance}
                editing={editing}
                onChange={setField("insurance")}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              VISITS
            </h3>
            <div className="space-y-3">
              <FieldRow label="Last Visit" value={form.lastVisit} disabled />
              <FieldRow
                label="Next Appointment"
                value={form.nextAppointment}
                disabled
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              HISTORY
            </h3>
            {record.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No history recorded.
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {record.history.map((h) => (
                  <li
                    key={h.id}
                    className="text-xs text-muted-foreground border-l-2 border-[oklch(0.55_0.18_245)] pl-2"
                  >
                    {h.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FieldRow({
  label,
  value,
  editing = false,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  editing?: boolean;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  if (disabled || !editing) {
    return (
      <div>
        <label className="text-[10px] tracking-wider text-muted-foreground block mb-0.5">
          {label}
        </label>
        <p className="text-sm font-medium">{value || "—"}</p>
      </div>
    );
  }

  return (
    <div>
      <label className="text-[10px] tracking-wider text-muted-foreground block mb-0.5">
        {label}
      </label>
      <input
        type="text"
        value={value === "—" ? "" : value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full px-2 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
      />
    </div>
  );
}
