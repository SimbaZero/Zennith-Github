import { isQuotaError } from "@/lib/form-rules";

// ---------------------------------------------------------------------------
// Clinic application review.
//
// A Super Admin reviews a clinic that registered itself before it goes live.
// The checks below are done BY HAND: Zennith isn't connected to a regulator or
// facility register, so nothing here is verified automatically. The checklist
// exists so the decision is deliberate and leaves a record of what was
// checked, not to imply the app did the checking.
// ---------------------------------------------------------------------------

export type ClinicType = "public" | "private";

/** The systemAudit action type every application decision is recorded under. */
export const DECISION_ACTION = "clinic.application_decision";

export interface ChecklistItem {
  key: string;
  label: string;
  help: string;
  /** "all" applies to every application; otherwise only that clinic type. */
  appliesTo: "all" | ClinicType;
}

export const REVIEW_CHECKLIST: ChecklistItem[] = [
  {
    key: "contact",
    label: "Contact person confirmed",
    help: "You called or emailed the contact and they replied.",
    appliesTo: "all",
  },
  {
    key: "facility",
    label: "Clinic exists and matches the name given",
    help: "Checked against the provincial facility list or a public register.",
    appliesTo: "all",
  },
  {
    key: "registration",
    label: "Registration number checked with the regulator",
    help: "Look it up by hand. The app cannot check it automatically.",
    appliesTo: "private",
  },
  {
    key: "location",
    label: "Address or location confirmed",
    help: "The address is real and belongs to this clinic.",
    appliesTo: "all",
  },
];

export type ChecklistState = Record<string, boolean>;

/** The checks that apply to this kind of clinic. */
export function checklistFor(type: ClinicType): ChecklistItem[] {
  return REVIEW_CHECKLIST.filter(
    (item) => item.appliesTo === "all" || item.appliesTo === type,
  );
}

/** Checks that apply to this clinic but haven't been ticked yet. */
export function missingChecks(
  type: ClinicType,
  state: ChecklistState,
): ChecklistItem[] {
  return checklistFor(type).filter((item) => !state[item.key]);
}

/** Approval is only allowed once every applicable check is ticked. */
export function canApprove(type: ClinicType, state: ChecklistState): boolean {
  return missingChecks(type, state).length === 0;
}

/** A rejection must come with a reason, because the applicant is sent it. */
export function isValidRejectionReason(reason: string): boolean {
  return reason.trim().length >= 5;
}

export function decisionLogText(input: {
  outcome: "approved" | "rejected";
  clinicName: string;
  type: ClinicType;
  state: ChecklistState;
  note?: string;
  reason?: string;
}): string {
  const checks = checklistFor(input.type);
  if (input.outcome === "approved") {
    const ticked = checks.filter((c) => input.state[c.key]).map((c) => c.label);
    const note = input.note?.trim() ? ` Note: ${input.note.trim()}` : "";
    return `Approved ${input.type} clinic application "${input.clinicName}". Checked: ${ticked.join("; ") || "nothing recorded"}.${note}`;
  }
  return `Rejected ${input.type} clinic application "${input.clinicName}". Reason given to applicant: ${(input.reason ?? "").trim()}`;
}

/** A starting point for the new admin's username, from their email address. */
export function suggestUsername(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
  return cleaned || "clinicadmin";
}

/** Explains, in plain words, why an email did not go out. */
export function emailFailureText(reason?: string): string {
  switch (reason) {
    case "not-configured":
      return "the email service isn't set up on this server";
    case "send-failed":
      return "the email service couldn't deliver it (emailing any address needs a verified sending domain, which isn't set up yet)";
    case "unauthenticated":
    case "not-super-admin":
    case "verify-failed":
      return "your session couldn't be verified, so sign in again and retry";
    case "invalid-input":
      return "the applicant's email address looks invalid";
    default:
      return "the email could not be sent";
  }
}

// ---- search ------------------------------------------------------------------

export interface SearchableApplication {
  clinicId: number;
  clinicName: string;
  address?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  registrationNumber?: string;
}

/** Matches on any registration detail (case-insensitive, partial). */
export function matchesApplicationSearch(
  app: SearchableApplication,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return [
    app.clinicName,
    app.contactName,
    app.contactEmail,
    app.contactPhone,
    app.registrationNumber,
    app.address,
    String(app.clinicId),
  ].some((value) => (value ?? "").toLowerCase().includes(q));
}

/** Why a list could not be loaded, in words a person can act on. Without this
 *  a failed load looks exactly like "nothing here yet". */
export function loadFailureText(err: unknown): string {
  return isQuotaError(err)
    ? "We've reached today's free database limit, so this couldn't be loaded. Please try again later."
    : "Something went wrong while loading this. Please try again.";
}
