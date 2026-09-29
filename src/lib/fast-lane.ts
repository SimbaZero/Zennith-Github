// ---------------------------------------------------------------------------
// Fast lane: a patient a clinician has judged clinically stable enough to
// collect their repeat medication directly from the pharmacist, without
// queuing through a nurse first (the real CCMDD programme this mirrors).
//
// This is a CLINICIAN'S JUDGEMENT, not a score. Nothing here computes
// eligibility automatically — a nurse or doctor sets the flag by hand, using
// the dose-taking history in src/lib/reminders.ts as evidence to weigh, the
// same way a blood pressure reading is evidence, not a verdict.
// ---------------------------------------------------------------------------

export const FAST_LANE_AUDIT_ACTION = "patient.fast_lane_changed";
export const HANDOVER_AUDIT_ACTION = "pharmacist.medication_handover";

export function fastLaneChangeLogText(
  patientId: string,
  turnedOn: boolean,
  by: string,
): string {
  return turnedOn
    ? `${patientId} marked as Fast Lane by ${by}.`
    : `${patientId} removed from Fast Lane by ${by}.`;
}

export function handoverLogText(
  patientId: string,
  med: string,
  by: string,
): string {
  return `Dispensed "${med}" to ${patientId} (Fast Lane) — dispensing confirmed by ${by}.`;
}

/**
 * Why a pharmacist hand-over is blocked, or null if it isn't. `fastLane` is
 * `undefined` for a patient nobody has ever set the flag on — treated the
 * same as explicitly off, since the whole point is that it must be turned ON
 * on purpose.
 */
export function handoverBlockedReason(
  fastLane: boolean | undefined,
): string | null {
  return fastLane === true
    ? null
    : "This patient is not marked Fast Lane. They need to collect this medication from a nurse.";
}
