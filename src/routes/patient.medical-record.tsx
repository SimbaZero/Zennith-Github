import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { currentPatient, patientVisits } from "@/lib/data";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/medical-record")({ component: MedicalRecord });

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold mt-0.5">{value}</p>
    </div>
  );
}

type MedAid = {
  provider: string; scheme: string; memberNo: string; privatePay: boolean;
};
const KEY = "zennith_medical_aid";
const DEFAULT: MedAid = { provider: "", scheme: "", memberNo: "", privatePay: true };

function MedicalRecord() {
  const p = currentPatient;
  const [aid, setAid] = useState<MedAid>(DEFAULT);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setAid({ ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<MedAid>) }); } catch {}
  }, []);
  const persist = (next: MedAid) => {
    setAid(next);
    if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  };
  const saveAid = (e: React.FormEvent) => {
    e.preventDefault();
    persist(aid);
    toast.success("Medical aid details saved");
  };

  return (
    <AppShell role="patient" title="My Medical Record">
      <div className="space-y-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name" value={p.name} />
            <Field label="Patient ID" value={p.id} />
            <Field label="ID Number" value={p.idNumber} />
            <Field label="Age / Gender" value={`${p.age} / ${p.gender}`} />
            <Field label="Cell Phone" value={p.cell} />
            <Field label="Status" value={p.status} />
          </div>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Medical History</h3>
          <div className="space-y-4">
            <Field label="Primary Condition" value={p.primaryCondition} />
            <Field label="Current Medication" value={p.medication} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Last Visit" value={p.lastVisit} />
              <Field label="Next Appointment" value={p.nextAppointment} />
            </div>
          </div>
        </div>

        <form onSubmit={saveAid} className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Medical Aid Details</h3>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Private / cash paying</span>
              <button
                type="button"
                onClick={() => persist({ ...aid, privatePay: !aid.privatePay })}
                className={`w-11 h-6 rounded-full border transition-colors relative ${aid.privatePay ? "bg-[oklch(0.55_0.18_245)] border-[oklch(0.55_0.18_245)]" : "bg-secondary border-border"}`}
              >
                <span className={`block w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${aid.privatePay ? "left-6" : "left-0.5"}`} />
              </button>
            </label>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 transition-opacity ${aid.privatePay ? "opacity-40 pointer-events-none" : ""}`}>
            <Input label="Provider" value={aid.provider} onChange={(v) => setAid({ ...aid, provider: v })} placeholder="e.g. Discovery Health" />
            <Input label="Scheme / Plan" value={aid.scheme} onChange={(v) => setAid({ ...aid, scheme: v })} placeholder="e.g. Keycare Plus" />
            <Input label="Member number" value={aid.memberNo} onChange={(v) => setAid({ ...aid, memberNo: v })} placeholder="e.g. 1234567" />
          </div>
          <button className="mt-4 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]">
            Save medical aid details
          </button>
        </form>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Visit History</h3>
          <div className="space-y-4">
            {patientVisits.map((v) => (
              <div key={v.date} className="border-b pb-3 last:border-0">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{v.date}</span>
                  <span className="text-muted-foreground">{v.doctor}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{v.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
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
