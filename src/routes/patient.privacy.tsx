import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/privacy")({
  component: PrivacyPage,
});

const KEY = "zennith_patient_privacy";
type PrivacyState = {
  shareForResearch: boolean;
  smsReminders: boolean;
  familyAccess: boolean;
};
const DEFAULTS: PrivacyState = {
  shareForResearch: false,
  smsReminders: true,
  familyAccess: false,
};

function load(): PrivacyState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return {
      ...DEFAULTS,
      ...(JSON.parse(
        localStorage.getItem(KEY) || "{}",
      ) as Partial<PrivacyState>),
    };
  } catch {
    return DEFAULTS;
  }
}
function save(s: PrivacyState) {
  if (typeof window !== "undefined")
    localStorage.setItem(KEY, JSON.stringify(s));
}

function PrivacyPage() {
  const [state, setState] = useState<PrivacyState>(DEFAULTS);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  useEffect(() => {
    setState(load());
  }, []);

  const toggle = (k: keyof PrivacyState) => {
    const next = { ...state, [k]: !state[k] };
    setState(next);
    save(next);
    toast.success("Privacy preference updated");
  };

  const submitDelete = () => {
    const requests = JSON.parse(
      localStorage.getItem("zennith_deletion_requests") || "[]",
    );
    requests.push({ ts: new Date().toISOString(), status: "pending" });
    localStorage.setItem("zennith_deletion_requests", JSON.stringify(requests));
    setStep(0);
    toast.success(
      "Deactivation request submitted — admin will confirm within 48 hours",
    );
  };

  return (
    <AppShell role="patient" title="Privacy & Data Settings">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-[oklch(0.97_0.03_245)] border border-[oklch(0.85_0.08_245)] rounded-xl p-5 flex gap-3">
          <ShieldCheck
            size={20}
            className="text-[oklch(0.4_0.15_245)] shrink-0 mt-0.5"
          />
          <div className="text-sm">
            <p className="font-semibold">POPIA Data Consent</p>
            <p className="text-muted-foreground mt-1">
              You control what personal data is visible in your record.
              Mandatory clinical fields (marked below) are required by law for
              safe healthcare delivery and cannot be hidden.
            </p>
          </div>
        </div>

        <section className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Mandatory clinical fields</h3>
          <ul className="text-sm space-y-2">
            {[
              "Full name",
              "ID number",
              "Date of birth",
              "Phone number",
              "Primary condition",
              "Current medication",
              "Emergency contact",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Lock size={14} className="text-muted-foreground" />
                <span>{f}</span>
                <span className="ml-auto text-[10px] tracking-wider text-muted-foreground">
                  REQUIRED
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-semibold">Optional visibility</h3>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-[oklch(0.94_0.1_75)] text-[oklch(0.4_0.15_75)]"
              title="Saved to this browser only right now — not yet synced to your account or visible to staff."
            >
              WIP · not yet saved to your account
            </span>
          </div>
          <div className="space-y-4">
            <Toggle
              label="Anonymised research use"
              desc="Allow anonymised, aggregated use of your data for public-health research."
              value={state.shareForResearch}
              onToggle={() => toggle("shareForResearch")}
            />
            <Toggle
              label="SMS/WhatsApp reminders"
              desc="Automated appointment and medication-ready reminders."
              value={state.smsReminders}
              onToggle={() => toggle("smsReminders")}
            />
            <Toggle
              label="Family / caregiver access"
              desc="Nominated family member can view your record with your consent code."
              value={state.familyAccess}
              onToggle={() => toggle("familyAccess")}
            />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-[oklch(0.85_0.1_25)] p-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-[oklch(0.55_0.2_25)]" />
            <h3 className="font-semibold text-[oklch(0.45_0.2_25)]">
              Delete / Disable Patient Record File
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            This requests deactivation of your record from all clinics.
            Historical clinical data is retained per DoH policy but your file is
            hidden from staff and reminders stop.
          </p>
          <button
            onClick={() => setStep(1)}
            className="border border-[oklch(0.6_0.2_25)] text-[oklch(0.45_0.2_25)] px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.97_0.05_25)]"
          >
            Request deactivation
          </button>
        </section>
      </div>

      {step > 0 && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            {step === 1 && (
              <>
                <h4 className="font-semibold text-lg">Are you sure?</h4>
                <p className="text-sm text-muted-foreground mt-2">
                  This will disable your patient record file across all Zennith
                  clinics.
                </p>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setStep(0)}
                    className="px-4 py-2 border rounded-md text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 bg-[oklch(0.55_0.2_25)] text-white rounded-md text-sm"
                  >
                    Continue
                  </button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <h4 className="font-semibold text-lg">
                  Are you absolutely sure?
                </h4>
                <p className="text-sm text-muted-foreground mt-2">
                  Nurses and doctors will no longer see your file. You'll lose
                  SMS reminders and scheduled appointments.
                </p>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setStep(0)}
                    className="px-4 py-2 border rounded-md text-sm"
                  >
                    No, keep my record
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="px-4 py-2 bg-[oklch(0.55_0.2_25)] text-white rounded-md text-sm"
                  >
                    Yes, continue
                  </button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <h4 className="font-semibold text-lg">Final confirmation</h4>
                <p className="text-sm text-muted-foreground mt-2">
                  Confirming this will request{" "}
                  <strong>complete file deactivation</strong>. An admin must
                  approve the request within 48 hours.
                </p>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setStep(0)}
                    className="px-4 py-2 border rounded-md text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitDelete}
                    className="px-4 py-2 bg-[oklch(0.55_0.2_25)] text-white rounded-md text-sm"
                  >
                    Submit deactivation
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Toggle({
  label,
  desc,
  value,
  onToggle,
}: {
  label: string;
  desc: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`shrink-0 w-11 h-6 rounded-full border transition-colors relative ${value ? "bg-[oklch(0.55_0.18_245)] border-[oklch(0.55_0.18_245)]" : "bg-secondary border-border"}`}
      >
        <span
          className={`block w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${value ? "left-6" : "left-0.5"}`}
        />
      </button>
    </label>
  );
}
