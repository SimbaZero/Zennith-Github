import { useEffect, useState } from "react";
import { Loading } from "@/components/Loading";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { updatePatient } from "@/lib/clinic-data";
import { logAction } from "@/lib/audit";
import { getUsername } from "@/lib/auth";
import { fetchAdherenceHistory } from "@/lib/patient-service";
import {
  STABLE_PATIENT_AUDIT_ACTION,
  STABLE_PATIENT_DISCLAIMER,
  STABLE_PATIENT_MEANING,
  stablePatientChangeLogText,
} from "@/lib/stable-patient";
import { summarizeAdherence, type AdherenceSummary } from "@/lib/reminders";

// ---------------------------------------------------------------------------
// Stable patient (CCMDD-eligible): a nurse or doctor's own clinical judgement
// (see src/lib/stable-patient.ts) - never computed automatically, and not queue
// priority. The dose-taking history is shown as evidence to weigh, not as a
// score that decides anything by itself; most of it may be the patient's own
// unwitnessed claim, which is labelled as such.
//
// Kept deliberately quiet: one small card, with the "internal estimate only"
// line always visible under the status.
// ---------------------------------------------------------------------------

export function StablePatientToggle({
  patientId,
  clinicId,
  prescription,
  stablePatient,
}: {
  patientId: string;
  clinicId?: number;
  prescription?: string;
  stablePatient: boolean;
}) {
  const [on, setOn] = useState(stablePatient);
  const [saving, setSaving] = useState(false);

  // The record can change from elsewhere (another tab, a reload of the live
  // listener); stay in sync with what's actually saved.
  useEffect(() => setOn(stablePatient), [stablePatient]);

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    try {
      const actor = getUsername() || "staff";
      await updatePatient(patientId, { stablePatient: next });
      logAction({
        clinicId: clinicId ?? null,
        actor_id: actor,
        action_type: STABLE_PATIENT_AUDIT_ACTION,
        description: stablePatientChangeLogText(patientId, next, actor),
      });
      setOn(next);
      toast.success(
        next
          ? `${patientId} marked as a stable patient`
          : `${patientId} removed from stable patient status`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-lg border p-4 print:hidden ${
        on ? "border-green-300 bg-green-50" : "border-border bg-secondary/30"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {on ? (
            <ShieldCheck size={18} className="text-green-700 shrink-0" />
          ) : (
            <ShieldOff size={18} className="text-muted-foreground shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold">
              {on
                ? "Stable patient — CCMDD-eligible"
                : "Not marked as a stable patient"}
            </p>
            <p className="text-xs text-muted-foreground">
              {on
                ? `${STABLE_PATIENT_MEANING} They can also have repeat medication handed over directly by the pharmacist.`
                : "A nurse or doctor can mark a patient as stable once they judge them stable enough for fewer in-person visits. Until then, medication is collected through a nurse."}
            </p>
            <p
              className="mt-1 text-[11px] italic text-muted-foreground"
              data-testid="stable-patient-disclaimer"
            >
              {STABLE_PATIENT_DISCLAIMER}
            </p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={`text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60 ${
            on
              ? "border border-destructive/50 text-destructive hover:bg-destructive/5"
              : "bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)]"
          }`}
        >
          {saving
            ? "Saving…"
            : on
              ? "Remove stable patient status"
              : "Mark as stable patient"}
        </button>
      </div>

      {prescription?.trim() && (
        <AdherenceEvidence patientId={patientId} med={prescription} />
      )}
    </div>
  );
}

function AdherenceEvidence({
  patientId,
  med,
}: {
  patientId: string;
  med: string;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [summary, setSummary] = useState<AdherenceSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetchAdherenceHistory(patientId, med, 30)
      .then((rows) => {
        if (!cancelled) setSummary(summarizeAdherence(rows));
      })
      .catch((err) => {
        console.error("Adherence history failed to load:", err);
        // Say so. Showing "no dose logs" here would be a false statement
        // about the patient, made to a clinician who is deciding on it.
        if (!cancelled) {
          setSummary(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, med]);

  return (
    <div className="mt-3 pt-3 border-t border-black/5 text-xs">
      <p className="text-[11px] tracking-wider text-muted-foreground mb-1">
        DOSE HISTORY — LAST 30 DAYS (EVIDENCE, NOT A SCORE)
      </p>
      {loading && (
        <p className="text-muted-foreground">
          <Loading label="Loading dose history" />
        </p>
      )}
      {!loading && failed && (
        <p className="text-muted-foreground">
          Couldn't load dose history. Try again in a moment.
        </p>
      )}
      {!loading && !failed && (!summary || summary.loggedDays === 0) && (
        <p className="text-muted-foreground">
          No dose logs on record for {med}.
        </p>
      )}
      {!loading && !failed && summary && summary.loggedDays > 0 && (
        <p>
          <strong>{summary.percentage}%</strong> of {summary.loggedDays} logged
          day{summary.loggedDays === 1 ? "" : "s"} marked taken.
          {summary.partialDays > 0 && (
            <span className="text-muted-foreground">
              {" "}
              {summary.partialDays} of those{" "}
              {summary.partialDays === 1 ? "was" : "were"} only partly taken
              (some of the day's doses missed).
            </span>
          )}
          {summary.selfReportedDays > 0 && (
            <span className="text-muted-foreground">
              {" "}
              {summary.selfReportedDays} of those{" "}
              {summary.selfReportedDays === 1 ? "was" : "were"} the patient's
              own claim, not witnessed by staff.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
