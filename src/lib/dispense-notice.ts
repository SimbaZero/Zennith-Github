// The notification a patient gets when medication is dispensed to them.
//
// One place builds it, so the nurse's dispense and the pharmacist's direct
// hand-over to a stable patient say the same thing in the same words: what
// was given, how much, and - when the person handing it over wrote one - how to
// take it ("Take twice daily").

/** Longest dosing note kept. A note, not a prescription. */
export const MAX_DOSING_NOTE = 200;

/** Quick choices offered next to the dosing-note box. */
export const DOSING_PRESETS: readonly string[] = [
  "Take once daily",
  "Take twice daily",
  "Take three times daily",
  "Take in the morning",
  "Take at night",
  "Take with food",
  "Take when needed",
];

/** A dosing note as it is stored and shown: single-spaced, trimmed, bounded. */
export function cleanDosingNote(raw: unknown): string {
  return typeof raw === "string"
    ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_DOSING_NOTE)
    : "";
}

/** The title and message of the "medication dispensed" notification. */
export function dispensedNotice(input: {
  unitsGiven: number;
  medName: string;
  dosingNote?: string | null;
}): { title: string; message: string } {
  const note = cleanDosingNote(input.dosingNote);
  const given = `You were given ${input.unitsGiven}× ${input.medName}.`;
  const dosing = note
    ? `\nDosing note: ${note}${/[.!?]$/.test(note) ? "" : "."}`
    : "";
  return {
    title: "Medication dispensed",
    message: `${given}${dosing}`,
  };
}
