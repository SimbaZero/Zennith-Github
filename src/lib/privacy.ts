import type { PrivacySettings } from "@/lib/patient-service";

// ---------------------------------------------------------------------------
// Applying a patient's privacy choices on the STAFF side.
//
// Patients set these on /patient/privacy and they are saved on the patient's
// own document as `patients/{id}.privacy`. Until this file existed, nothing
// on the staff side read that field, so a patient could switch a toggle off
// and nurses, doctors and receptionists would still see everything.
//
// Every staff-facing loader that returns personal details must run its
// values through this, so all three roles behave identically.
//
// Rule: a setting is only "hidden" when it is explicitly false. A patient who
// has never opened the privacy page has no `privacy` field at all, and the
// patient page shows those toggles as ON (see PRIVACY_DEFAULTS in
// patient-service.ts), so staff must see the data in that case too.
// ---------------------------------------------------------------------------

/** What staff see in place of a value the patient has chosen to hide. */
export const HIDDEN_BY_PATIENT = "Hidden by patient";

/** Merges the stored `privacy` map with the defaults. Accepts anything,
 *  because it comes straight off a Firestore document. */
export function resolvePrivacy(raw: unknown): PrivacySettings {
  const stored =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  return {
    showIdNumber: stored.showIdNumber !== false,
    showContact: stored.showContact !== false,
    showEmergencyContact: stored.showEmergencyContact !== false,
    showAddress: stored.showAddress !== false,
  };
}

/** Returns `value` if the patient allows it, otherwise the hidden marker. */
export function gate(allowed: boolean, value: string): string {
  return allowed ? value : HIDDEN_BY_PATIENT;
}
