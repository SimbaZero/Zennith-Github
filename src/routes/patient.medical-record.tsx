import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientVisitHistory,
} from "@/lib/patient-service";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/medical-record")({
  component: MedicalRecord,
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold mt-0.5">{value || "—"}</p>
    </div>
  );
}

type MedAid = {
  provider: string;
  scheme: string;
  memberNo: string;
  privatePay: boolean;
};
const KEY = "zennith_medical_aid";
const DEFAULT: MedAid = {
  provider: "",
  scheme: "",
  memberNo: "",
  privatePay: true,
};

function MedicalRecord() {
  const { patient, loading } = useCurrentPatient();
  const visits = usePatientVisitHistory(patient?.medicalRecordNo);

  // Medical Aid section stays localStorage-only — no matching Firestore
  // collection exists yet (see db-issues.md #10).
  const [aid, setAid] = useState<MedAid>(DEFAULT);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setAid({
        ...DEFAULT,
        ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<MedAid>),
      });
    } catch {
      // ignore malformed localStorage data, just use defaults
    }
  }, []);
  const persist = (next: MedAid) => {
    setAid(next);
    if (typeof window !== "undefined")
      localStorage.setItem(KEY, JSON.stringify(next));
  };
  const saveAid = (e: React.FormEvent) => {
    e.preventDefault();
    persist(aid);
    toast.success("Medical aid details saved");
  };

  if (loading) {
    return (
      <AppShell role="patient" title="My Medical Record">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </AppShell>
    );
  }

  return (
    <AppShell role="patient" title="My Medical Record">
      <div className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name" value={patient?.fullName ?? ""} />
            <Field label="Patient ID" value={patient?.patientId ?? ""} />
            <Field label="ID Number" value={patient?.idNumber ?? ""} />
            <Field label="Cell Phone" value={patient?.contactNum ?? ""} />
            <Field
              label="Emergency Contact"
              value={patient?.emergencyContactName ?? ""}
            />
            <Field
              label="Emergency Contact No."
              value={patient?.emergencyContactNo ?? ""}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Medical History</h3>
          <div className="space-y-4">
            <Field
              label="Primary Condition"
              value={patient?.chronicCondition ?? ""}
            />
            <Field
              label="Current Prescription"
              value={patient?.prescription ?? ""}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Blood Type" value={patient?.bloodType ?? ""} />
              <Field label="Allergies" value={patient?.allergies ?? ""} />
              <Field label="Blood Pressure" value={patient?.bp ?? ""} />
              <Field
                label="Glucose"
                value={patient?.glucose != null ? String(patient.glucose) : ""}
              />
              <Field
                label="Last Visit"
                value={
                  patient?.lastVisit
                    ? new Date(patient.lastVisit).toLocaleDateString("en-ZA")
                    : ""
                }
              />
            </div>
          </div>
        </div>

        <form onSubmit={saveAid} className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Medical Aid Details</h3>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Private / cash paying
              </span>
              <button
                type="button"
                onClick={() => persist({ ...aid, privatePay: !aid.privatePay })}
                className={`w-11 h-6 rounded-full border transition-colors relative ${aid.privatePay ? "bg-[oklch(0.55_0.18_245)] border-[oklch(0.55_0.18_245)]" : "bg-secondary border-border"}`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${aid.privatePay ? "left-6" : "left-0.5"}`}
                />
              </button>
            </label>
          </div>
          <div
            className={`grid grid-cols-1 sm:grid-cols-3 gap-4 transition-opacity ${aid.privatePay ? "opacity-40 pointer-events-none" : ""}`}
          >
            <Input
              label="Provider"
              value={aid.provider}
              onChange={(v) => setAid({ ...aid, provider: v })}
              placeholder="e.g. Discovery Health"
            />
            <Input
              label="Scheme / Plan"
              value={aid.scheme}
              onChange={(v) => setAid({ ...aid, scheme: v })}
              placeholder="e.g. Keycare Plus"
            />
            <Input
              label="Member number"
              value={aid.memberNo}
              onChange={(v) => setAid({ ...aid, memberNo: v })}
              placeholder="e.g. 1234567"
            />
          </div>
          <button className="mt-4 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]">
            Save medical aid details
          </button>
        </form>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Visit History</h3>
          <div className="space-y-4">
            {visits.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No visit history recorded.
              </p>
            )}
            {visits.map((v) => (
              <div key={v.docId} className="border-b pb-3 last:border-0">
                <p className="text-sm text-muted-foreground">{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] text-sm"
      />
    </div>
  );
}
