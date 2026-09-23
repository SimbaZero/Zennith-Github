import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ShieldCheck, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import {
  useCurrentPatient,
  usePrivacySettings,
  savePrivacySetting,
  requestDataDeletion,
  type PrivacySettings,
} from "@/lib/patient-service";
import { isOffline } from "@/lib/offline";

export const Route = createFileRoute("/patient/privacy")({
  component: PatientPrivacy,
});

const FIELDS: {
  key: keyof PrivacySettings;
  label: string;
  detail: string;
}[] = [
  {
    key: "showIdNumber",
    label: "ID / passport number",
    detail: "Shown to clinic staff who open your record.",
  },
  {
    key: "showContact",
    label: "Phone number and email",
    detail: "Used to reach you about appointments and medication.",
  },
  {
    key: "showEmergencyContact",
    label: "Emergency contact",
    detail: "Who the clinic calls if you can't be reached.",
  },
  {
    key: "showAddress",
    label: "Home address",
    detail: "Used for your nearest-clinic suggestions.",
  },
];

function PatientPrivacy() {
  const { patient } = useCurrentPatient();
  const { settings, loading } = usePrivacySettings(patient?.patientId);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = async (key: keyof PrivacySettings) => {
    if (!patient?.patientId) return;
    try {
      await savePrivacySetting(patient.patientId, key, !settings[key]);
      // Offline the preference is saved locally and uploads on reconnect.
      // Saying so matters more here than elsewhere: a patient changing who
      // can see their data needs to know when it actually takes effect for
      // the staff treating them.
      toast.success(
        isOffline()
          ? "Saved on this device — it will sync when you're back online"
          : "Privacy preference updated",
      );
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that — please try again.");
    }
  };

  const submitDelete = async () => {
    if (!patient?.patientId) return;
    setBusy(true);
    try {
      await requestDataDeletion({
        patientId: patient.patientId,
        clinicId: patient.clinicId,
        reason: reason.trim() || undefined,
      });
      setStep(0);
      setReason("");
      toast.success(
        isOffline()
          ? "Request saved on this device — it will be sent to your clinic's admin when you're back online."
          : "Request submitted — your clinic's admin has been notified.",
      );
    } catch (err) {
      console.error(err);
      toast.error("Couldn't submit the request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      role="patient"
      title="Privacy & Data Settings"
      clinicNameOverride={patient?.clinicName}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-[oklch(0.97_0.03_245)] border border-[oklch(0.85_0.08_245)] rounded-xl p-5 flex gap-3">
          <ShieldCheck
            size={20}
            className="text-[oklch(0.4_0.15_245)] shrink-0 mt-0.5"
          />
          <div className="text-sm">
            <p className="font-semibold">POPIA Data Consent</p>
            <p className="text-muted-foreground mt-1">
              You control what personal information clinic staff can see in your
              record. Clinical details needed for safe treatment — diagnoses,
              medication, allergies — are always visible to the staff treating
              you and can't be hidden.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border">
          <div className="p-5 border-b">
            <h3 className="font-semibold">What staff can see</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Saved to your record, so these apply wherever you sign in.
            </p>
          </div>
          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y">
              {FIELDS.map((f) => (
                <li
                  key={f.key}
                  className="p-5 flex items-start justify-between gap-4"
                >
                  <div>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {f.detail}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(f.key)}
                    className={`shrink-0 w-12 h-6 rounded-full transition relative ${
                      settings[f.key]
                        ? "bg-[oklch(0.55_0.18_245)]"
                        : "bg-secondary border"
                    }`}
                    aria-label={`Toggle ${f.label}`}
                  >
                    <span
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                        settings[f.key] ? "left-6" : "left-0.5"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={16} className="text-[oklch(0.55_0.2_25)]" />
            <h3 className="font-semibold">Deactivate my account</h3>
          </div>

          {/* Deliberately honest about what this does. The previous version
              said "admin will confirm within 48 hours" while saving the
              request to the patient's own browser, where nobody could ever
              see it. It also implied deletion happens on request, which
              POPIA doesn't allow for medical records still within their
              retention period. */}
          <p className="text-sm text-muted-foreground mt-1">
            This asks your clinic to deactivate your account. It is a request,
            not an immediate deletion — clinics are legally required to keep
            medical records for a set period, so an administrator reviews it
            first and will contact you.
          </p>

          {step === 0 && (
            <button
              onClick={() => setStep(1)}
              className="mt-4 text-sm border px-4 py-2 rounded-md hover:bg-secondary"
            >
              Request deactivation
            </button>
          )}

          {step === 1 && (
            <div className="mt-4 space-y-3">
              <label className="text-sm font-medium block">
                Why are you leaving? (optional)
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Helps your clinic understand — not required"
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 border py-2 rounded-md text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 bg-[oklch(0.55_0.2_25)] text-white py-2 rounded-md text-sm"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="mt-4 rounded-md border border-[oklch(0.85_0.12_25)] bg-[oklch(0.98_0.03_25)] p-4">
              <p className="text-sm font-medium">Are you sure?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your clinic's administrator will be notified and will contact
                you. You can keep using your account until they respond.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 border bg-white py-2 rounded-md text-sm"
                >
                  Keep my account
                </button>
                <button
                  onClick={submitDelete}
                  disabled={busy}
                  className="flex-1 bg-[oklch(0.55_0.2_25)] text-white py-2 rounded-md text-sm disabled:opacity-60 flex items-center justify-center gap-1"
                >
                  <Check size={14} />
                  {busy ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
