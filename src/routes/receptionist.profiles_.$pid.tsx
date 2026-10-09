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
  resolveCurrentReceptionist,
  nameTokens,
  type ReceptionPatientRecord,
} from "@/lib/clinic-data";
import { logAction } from "@/lib/audit";
import { normalizeInsurance } from "@/lib/record-edit";
import { HIDDEN_BY_PATIENT } from "@/lib/privacy";
import {
  DOCUMENT_CHECK_NOTE,
  ID_TYPE_LABELS,
  SA_ID_CHECK_NOTE,
  isIdType,
  validateIdByType,
} from "@/lib/sa-id";

// Which part of the file each editable field belongs to. The audit log
// records the SECTION that changed, never the values, so the log doesn't
// become a second copy of the patient's personal details.
const FIELD_SECTIONS: Partial<Record<keyof Form, string>> = {
  name: "personal details",
  idType: "personal details",
  idNumber: "personal details",
  cell: "personal details",
  suburb: "personal details",
  city: "personal details",
  email: "personal details",
  emergencyContactName: "emergency contact",
  emergencyContactNo: "emergency contact",
  insurance: "insurance",
};

export const Route = createFileRoute("/receptionist/profiles_/$pid")({
  component: PatientDetail,
});

// POPIA: this page is deliberately administrative only — identity, contact
// details, address, emergency contact, insurance and visit dates. There is no
// chronic condition, blood type, allergies, medication, vitals, CD4/viral
// load (which effectively disclose HIV status) or clinical history here, and
// fetchPatientRecord doesn't fetch them. Reception has no clinical role, so it
// has no need to see or edit them. Don't add clinical fields back to this
// page; nurses and doctors edit them in PatientRecordView.

type Form = {
  name: string;
  idType: string;
  idNumber: string;
  cell: string;
  email: string;
  suburb: string;
  city: string;
  emergencyContactName: string;
  emergencyContactNo: string;
  insurance: string;
  lastVisit: string;
  nextAppointment: string;
};

// "none" = registered without any identity document (see registration).
const ID_TYPE_OPTIONS = { ...ID_TYPE_LABELS, none: "No document" };

function formFrom(record: ReceptionPatientRecord): Form {
  return {
    name: record.name,
    // Older records have no idType — assume from the number's shape until
    // reception picks one.
    idType:
      isIdType(record.idType) || record.idType === "none"
        ? record.idType
        : /^\d{13}$/.test(record.idNumber)
          ? "sa_id"
          : "other",
    idNumber: record.idNumber,
    cell: record.cell,
    email: record.email,
    suburb: record.suburb,
    city: record.city,
    emergencyContactName: record.emergencyContactName,
    emergencyContactNo: record.emergencyContactNo,
    insurance: record.insurance,
    lastVisit: record.lastVisit,
    nextAppointment: record.nextAppointment,
  };
}

function PatientDetail() {
  const { pid } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
  });

  const {
    data: record,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["patient-record", pid],
    queryFn: () => fetchPatientRecord(pid),
  });

  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (record) setForm(formFrom(record));
  }, [record]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!record || !form) throw new Error("No record loaded");

      // Only re-check the ID when reception changed it — an older record
      // with a malformed ID shouldn't block fixing a phone number.
      const idNumber =
        form.idType === "none" ? "" : form.idNumber.replace(/\s+/g, "");
      const privacy = record.privacy;
      // A hidden ID is never re-checked or written: the form holds the
      // "Hidden by patient" marker for it, not the real number.
      const idChanged =
        privacy.showIdNumber &&
        (idNumber !== record.idNumber.replace(/\s+/g, "") ||
          form.idType !== formFrom(record).idType);
      if (idChanged && isIdType(form.idType)) {
        const check = validateIdByType(idNumber, form.idType);
        if (!check.valid) throw new Error(check.reason);
      }

      // Parse name into first/surname
      const parts = form.name.trim().split(/\s+/);
      const names = parts[0] || "";
      const surname = parts.slice(1).join(" ");

      // Reads the patient doc only (not medicalRecords) to find the linked ids.
      const patientSnap = await getDoc(doc(db, "patients", pid));
      if (!patientSnap.exists()) throw new Error("Patient not found");

      const patientData = patientSnap.data();
      const userId = patientData.userId;
      const recordNo = patientData.medicalRecordNo;

      // Blank or "None" both mean no insurance, and both are stored as null.
      // Typing "None" used to become `undefined`, which the write layer drops —
      // so it looked saved and the old policy number came back. Compared in the
      // same normalised form, so "None" over "None" isn't a change either.
      const insurance = normalizeInsurance(form.insurance);
      const insuranceChanged =
        insurance !== normalizeInsurance(record.insurance);
      // The name is saved on the users document above, but the patient list is
      // searched by name through a copy of it on the patient document — so a
      // renamed patient has to have that copy rewritten too, or they stay
      // findable only under the old spelling.
      const nameChanged = form.name.trim() !== record.name.trim();

      // The person's own record goes first, and finishes, before the patient
      // document is touched. Doctors' and nurses' patient lists cache a name
      // against the patient document's last-updated stamp and re-read the name
      // when it changes (see patientDetailCache in doctor-service) — so if both
      // were written at once, a list could see the new stamp, read the not-yet-
      // saved old name, and keep showing it. Written in this order, the new stamp
      // can only ever be seen after the new name is already there.
      await updateUser(userId, {
        names,
        surname,
        ...(idChanged ? { idNumber, idType: form.idType } : {}),
        // Fields the patient has hidden are locked on screen and skipped
        // here, so the marker text can never overwrite the real value.
        ...(privacy.showContact
          ? { contactNum: form.cell, email: form.email }
          : {}),
        // Address used to be shown as editable but was never written.
        ...(privacy.showAddress
          ? { suburb: form.suburb.trim(), city: form.city.trim() }
          : {}),
      });
      await Promise.all([
        // No chronicCondition — reception doesn't edit clinical data (POPIA).
        updatePatient(pid, {
          ...(privacy.showEmergencyContact
            ? {
                emergencyContactName: form.emergencyContactName,
                emergencyContactNo: form.emergencyContactNo,
              }
            : {}),
          ...(insuranceChanged ? { insurancePolicyNumber: insurance } : {}),
          ...(nameChanged ? { nameTokensLower: nameTokens(form.name) } : {}),
        }),
        // Insurance is also mirrored to medicalRecords, where nurses and
        // doctors read it. This is a blind field write — reception never
        // reads the clinical record — and only happens if insurance changed.
        insuranceChanged && recordNo != null
          ? updateMedicalRecord(recordNo, { insurancePolicyNumber: insurance })
          : Promise.resolve(),
      ]);

      // Audit trail — only if something actually changed. Compared against
      // formFrom(record), not the raw record, so an idType inferred for an
      // older record doesn't count as an edit.
      const original = formFrom(record);
      const changedSections = [
        ...new Set(
          (Object.keys(FIELD_SECTIONS) as (keyof Form)[])
            .filter((k) => form[k] !== original[k])
            .map((k) => FIELD_SECTIONS[k]!),
        ),
      ];
      if (changedSections.length > 0) {
        logAction({
          clinicId:
            patientData.clinicId != null ? Number(patientData.clinicId) : null,
          actor_id: receptionist?.receptionistId || "receptionist",
          action_type: "patient.update",
          description: `receptionist updated patient file for ${pid} (${changedSections.join(", ")})`,
        });
      }
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

  const setField = (key: keyof Form) => (value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  if (isLoading) {
    return (
      <AppShell
        role="receptionist"
        title="Patient Profile"
        clinicNameOverride={receptionist?.clinicName}
        staffNameOverride={receptionist?.name}
      >
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (isError || !record || !form) {
    return (
      <AppShell
        role="receptionist"
        title="Patient Profile"
        clinicNameOverride={receptionist?.clinicName}
        staffNameOverride={receptionist?.name}
      >
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

  const privacy = record.privacy;
  const anyHidden = !(
    privacy.showIdNumber &&
    privacy.showContact &&
    privacy.showAddress &&
    privacy.showEmergencyContact
  );

  return (
    <AppShell
      role="receptionist"
      title={`Patient Profile — ${record.name}`}
      clinicNameOverride={receptionist?.clinicName}
      staffNameOverride={receptionist?.name}
    >
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
                  setForm(formFrom(record));
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

      {anyHidden && (
        <p className="mb-4 text-xs text-muted-foreground">
          Some details are hidden and locked because the patient has chosen not
          to share them with staff.
        </p>
      )}

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
              {privacy.showIdNumber ? (
                <SelectRow
                  label="ID Type"
                  value={form.idType}
                  options={ID_TYPE_OPTIONS}
                  editing={editing}
                  onChange={setField("idType")}
                />
              ) : (
                <FieldRow label="ID Type" value={HIDDEN_BY_PATIENT} disabled />
              )}
              {form.idType !== "none" && (
                <FieldRow
                  label="ID Number"
                  value={form.idNumber}
                  editing={editing && privacy.showIdNumber}
                  onChange={setField("idNumber")}
                />
              )}
              {editing && privacy.showIdNumber && form.idType !== "none" && (
                <p className="text-[11px] text-muted-foreground">
                  {form.idType === "sa_id"
                    ? SA_ID_CHECK_NOTE
                    : DOCUMENT_CHECK_NOTE}
                </p>
              )}
              <FieldRow
                label="Cell"
                value={form.cell}
                editing={editing && privacy.showContact}
                onChange={setField("cell")}
              />
              <FieldRow
                label="Email"
                value={form.email}
                editing={editing && privacy.showContact}
                onChange={setField("email")}
              />
            </div>
          </div>
        </div>

        {/* Middle column — Address + Emergency contact */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-sm tracking-wider mb-4">
              ADDRESS
            </h3>
            <div className="space-y-3">
              <FieldRow
                label="Suburb / Street"
                value={form.suburb}
                editing={editing && privacy.showAddress}
                onChange={setField("suburb")}
              />
              <FieldRow
                label="City / District"
                value={form.city}
                editing={editing && privacy.showAddress}
                onChange={setField("city")}
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
                editing={editing && privacy.showEmergencyContact}
                onChange={setField("emergencyContactName")}
              />
              <FieldRow
                label="Phone"
                value={form.emergencyContactNo}
                editing={editing && privacy.showEmergencyContact}
                onChange={setField("emergencyContactNo")}
              />
            </div>
          </div>
        </div>

        {/* Right column — Insurance + Visits */}
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
  const valueClass =
    value === HIDDEN_BY_PATIENT
      ? "text-sm italic text-muted-foreground"
      : "text-sm font-medium";
  if (disabled || !editing) {
    return (
      <div>
        <label className="text-[10px] tracking-wider text-muted-foreground block mb-0.5">
          {label}
        </label>
        <p className={valueClass}>{value || "—"}</p>
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

function SelectRow({
  label,
  value,
  options,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] tracking-wider text-muted-foreground block mb-0.5">
        {label}
      </label>
      {editing ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
        >
          {Object.entries(options).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm font-medium">{options[value] ?? "—"}</p>
      )}
    </div>
  );
}
