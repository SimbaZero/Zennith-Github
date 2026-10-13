// ---------------------------------------------------------------------------
// Stable patient (CCMDD-eligible).
//
// A patient a nurse or doctor has judged clinically stable enough that the
// clinic could consider reducing how often they have to come in - the kind of
// patient South Africa's CCMDD programme (Central Chronic Medicines Dispensing
// and Distribution, also called "dablapmeds") is for: stable chronic patients
// collect repeat medicine from an alternative pickup point instead of queuing at
// the clinic every time.
//
// What this is NOT:
//   - It is not queue priority. Nothing here moves a patient up, or off, any
//     queue at a visit.
//   - It is not an official CCMDD assessment or enrolment. Whether a patient is
//     actually moved to CCMDD collection is decided and done through the real
//     programme. This marker is the clinic's own, internal note that the patient
//     might be a candidate.
//   - It is not computed. A nurse or doctor sets it by hand, using the
//     dose-taking history in src/lib/reminders.ts as evidence to weigh, the same
//     way a blood-pressure reading is evidence rather than a verdict. Any
//     figure shown beside it is an internal estimate, not a clinical standard.
//
// Within the clinic, a stable patient may also have repeat medication handed
// over directly by the pharmacist, without seeing a nurse first.
//
// History: this was called "Fast Lane" and described as skipping the queue. That
// did not match how CCMDD works, so it was renamed and reframed.
// ---------------------------------------------------------------------------

/** Shown wherever the status, or a figure behind it, is shown. */
export const STABLE_PATIENT_DISCLAIMER =
  "Internal estimate only — not an official CCMDD assessment.";

/** The short name for the status. */
export const STABLE_PATIENT_LABEL = "Stable patient";

/** What the status means for the patient, in one sentence. */
export const STABLE_PATIENT_MEANING =
  "Stable enough that the clinic could consider fewer in-person visits, with repeat medicine collected from an alternative pickup point (CCMDD).";

/** The patient document's field. */
export const STABLE_PATIENT_FIELD = "stablePatient";

export const STABLE_PATIENT_AUDIT_ACTION = "patient.stable_status_changed";
/**
 * What the same change was logged as before the rename. Old audit entries keep
 * this action type, so anything that recognises the new one must recognise it
 * too.
 */
export const LEGACY_FAST_LANE_AUDIT_ACTION = "patient.fast_lane_changed";
export const HANDOVER_AUDIT_ACTION = "pharmacist.medication_handover";

/**
 * Whether a patient document is marked as a stable patient. Reads the current
 * field, and falls back to the one used before the rename (`fastLane`) so
 * patients already marked stay marked. An explicit `false` in the new field
 * wins over a leftover legacy `true`.
 */
export function isStablePatient(
  data: { stablePatient?: unknown; fastLane?: unknown } | null | undefined,
): boolean {
  if (!data) return false;
  if (typeof data.stablePatient === "boolean") return data.stablePatient;
  return data.fastLane === true;
}

export function stablePatientChangeLogText(
  patientId: string,
  turnedOn: boolean,
  by: string,
): string {
  return turnedOn
    ? `${patientId} marked as a stable patient (CCMDD-eligible) by ${by}.`
    : `${patientId} removed from stable patient status by ${by}.`;
}

export function handoverLogText(
  patientId: string,
  med: string,
  by: string,
): string {
  return `Handed over "${med}" to ${patientId} (stable patient) — handover confirmed by ${by}.`;
}

/**
 * Why a pharmacist hand-over is blocked, or null if it isn't. `stablePatient`
 * is `undefined` for a patient nobody has ever set the status on - treated the
 * same as explicitly off, since the whole point is that it must be turned ON on
 * purpose.
 */
export function handoverBlockedReason(
  stablePatient: boolean | undefined,
): string | null {
  return stablePatient === true
    ? null
    : "This patient is not marked as a stable patient. They need to collect this medication from a nurse.";
}
