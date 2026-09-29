import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { updatePatient } from "@/lib/clinic-data";
import { logAction } from "@/lib/audit";
import { getUsername } from "@/lib/auth";
import { fetchAdherenceHistory } from "@/lib/patient-service";
import { FAST_LANE_AUDIT_ACTION, fastLaneChangeLogText } from "@/lib/fast-lane";
import { summarizeAdherence, type AdherenceSummary } from "@/lib/reminders";

// ---------------------------------------------------------------------------
// A nurse or doctor's own clinical judgement (see src/lib/fast-lane.ts) —
// never computed automatically. The dose-taking history is shown as evidence
// to weigh, not as a score that decides anything by itself; most of it may be
// the patient's own unwitnessed claim, which is labelled as such.
// ---------------------------------------------------------------------------

export function FastLaneToggle({
  patientId,
  clinicId,
  prescription,
  fastLane,
}: {
  patientId: string;
  clinicId?: number;
  prescription?: string;
  fastLane: boolean;
}) {
  const [on, setOn] = useState(fastLane);
  const [saving, setSaving] = useState(false);

  // The record can change from elsewhere (another tab, a reload of the live
  // listener); stay in sync with what's actually saved.
  useEffect(() => setOn(fastLane), [fastLane]);

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    try {
      const actor = getUsername() || "staff";
      await updatePatient(patientId, { fastLane: next });
      logAction({
        clinicId: clinicId ?? null,
        actor_id: actor,
        action_type: FAST_LANE_AUDIT_ACTION,
        description: fastLaneChangeLogText(patientId, next, actor),
      });
      setOn(next);
      toast.success(
        next
          ? `${patientId} marked as Fast Lane`
          : `${patientId} removed from Fast Lane`,
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
              Fast Lane {on ? "— On" : "— Off"}
            </p>
            <p className="text-xs text-muted-foreground">
              {on
                ? "This patient may collect repeat medication directly from the pharmacist."
                : "This patient must queue with a nurse to collect medication."}
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
          {saving ? "Saving…" : on ? "Remove from Fast Lane" : "Mark Fast Lane"}
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
  const [summary, setSummary] = useState<AdherenceSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAdherenceHistory(patientId, med, 30)
      .then((rows) => {
        if (!cancelled) setSummary(summarizeAdherence(rows));
      })
      .catch((err) => {
        console.error("Adherence history failed to load:", err);
        if (!cancelled) setSummary(null);
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
      {loading && <p className="text-muted-foreground">Loading…</p>}
      {!loading && (!summary || summary.loggedDays === 0) && (
        <p className="text-muted-foreground">
          No dose logs on record for {med}.
        </p>
      )}
      {!loading && summary && summary.loggedDays > 0 && (
        <p>
          <strong>{summary.percentage}%</strong> of {summary.loggedDays} logged
          day{summary.loggedDays === 1 ? "" : "s"} marked taken.
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
