import type {
  MedicalRecordUpdateInput,
  PatientUpdateInput,
} from "@/lib/clinic-data";

// What a nurse or doctor changed on the patient-record edit form, as the writes
// that should be made.
//
// The point of this file is one distinction the form used to lose: a field the
// person EMPTIED is not the same as a field they never touched.
//   - emptied     -> `null`: write "nothing recorded" over the old value
//   - untouched   -> left out entirely: don't write it at all
//   - changed     -> the new value
// The old code turned "emptied" into `undefined` — and updateDoc cannot take
// `undefined`, so the write layer strips it. Clearing an allergy therefore did
// nothing: the success message appeared and the old value came back on reload.
//
// `null` rather than "" because that is what "none recorded" already is
// everywhere else — registration writes null, and every reader falls back on it
// ("None recorded", "—") — whereas "" would display as a blank.

export interface EditableFields {
  condition: string;
  bloodType: string;
  allergies: string;
  prescription: string;
  dosage: string;
  bp: string;
  glucose: string;
  cd4: string;
  viralLoad: string;
}

/**
 * Compares the form with how it looked when editing began and returns only what
 * changed. Comparing against the starting values (not the live record) also
 * means a field you never touched is never overwritten with a stale copy of
 * what somebody else has since saved.
 */
export function editedFields(
  baseline: EditableFields,
  form: EditableFields,
): { patient: PatientUpdateInput; record: MedicalRecordUpdateInput } {
  const patient: PatientUpdateInput = {};
  const record: MedicalRecordUpdateInput = {};

  const changed = (k: keyof EditableFields) =>
    form[k].trim() !== baseline[k].trim();
  const text = (k: keyof EditableFields) => form[k].trim() || null;
  const num = (k: keyof EditableFields) =>
    form[k].trim() === "" ? null : Number(form[k]);

  if (changed("condition")) patient.chronicCondition = text("condition");
  if (changed("bloodType")) record.bloodType = text("bloodType");
  if (changed("allergies")) record.allergies = text("allergies");
  if (changed("prescription")) record.prescription = text("prescription");
  if (changed("dosage")) record.dosage = num("dosage");
  if (changed("bp")) record.bp = text("bp");
  if (changed("glucose")) record.glucose = num("glucose");
  if (changed("cd4")) record.cd4 = num("cd4");
  if (changed("viralLoad")) record.viralLoad = num("viralLoad");

  return { patient, record };
}

/**
 * The insurance box on reception's profile page, as the value to store.
 * Blank, or the word "None" (which is what the box shows when nothing is
 * recorded, so it is what people type to clear it), means no insurance: null.
 * Previously "None" came out as `undefined` and was silently not written.
 */
export function normalizeInsurance(raw: string): string | null {
  const v = raw.trim();
  return v === "" || v.toLowerCase() === "none" ? null : v;
}
