// ---------------------------------------------------------------------------
// Identity document validation.
//
// A South African ID number is self-validating, so it gets a strict check.
// Every other document (passport, asylum-seeker permit, refugee permit, …)
// can only be checked for a plausible format — there is no public checksum,
// and confirming any of them is genuine needs a paid verification service.
// The UI says so honestly rather than implying more than we checked.
//
// Every check returns a specific reason, so forms can tell the person what
// is actually wrong instead of a generic "invalid".
// ---------------------------------------------------------------------------

import { passesLuhn } from "@/lib/luhn";

export interface IdCheck {
  valid: boolean;
  /** Why it failed — worded to show directly to the person typing. */
  reason?: string;
  /** YYYY-MM-DD, decoded from a valid SA ID number. */
  dateOfBirth?: string;
}

// Digit 11 (index 10) of an SA ID number is citizenship status:
//   0 = South African citizen
//   1 = permanent resident
//   2 = refugee
// Do NOT "tidy" this back to 0/1. Rejecting 2 turns away refugee patients —
// the people a public clinic most needs to be able to register.
const CITIZENSHIP_DIGITS = ["0", "1", "2"];

/**
 * Validate a 13-digit South African ID number:
 *   digits 1–6   YYMMDD date of birth (must be a real, non-future date)
 *   digits 7–10  gender sequence (not checked — any value is legitimate)
 *   digit 11     citizenship: 0, 1 or 2 (see CITIZENSHIP_DIGITS)
 *   digit 12     historically race; no longer used, any value is fine
 *   digit 13     Luhn check digit over the first 12
 *
 * Proves the number is well-formed, NOT that it was issued to this person —
 * see verifyWithHomeAffairs below.
 */
export function validateSaId(raw: string, today: Date = new Date()): IdCheck {
  const id = raw.replace(/\s+/g, "");

  if (!id) return { valid: false, reason: "Enter the 13-digit ID number." };
  if (!/^\d+$/.test(id))
    return {
      valid: false,
      reason: "A South African ID number contains digits only.",
    };
  if (id.length !== 13)
    return {
      valid: false,
      reason: `A South African ID number is 13 digits — this one has ${id.length}.`,
    };

  const dateOfBirth = decodeDateOfBirth(id.slice(0, 6), today);
  if (!dateOfBirth)
    return {
      valid: false,
      reason:
        "The first six digits should be the date of birth (YYMMDD), but they aren't a real date.",
    };

  const citizenship = id[10];
  if (!CITIZENSHIP_DIGITS.includes(citizenship))
    return {
      valid: false,
      reason: `The 11th digit must be 0 (SA citizen), 1 (permanent resident) or 2 (refugee) — this one is ${citizenship}.`,
    };

  if (!passesLuhn(id))
    return {
      valid: false,
      reason:
        "The last digit (a check digit) doesn't match the rest of the number — there's probably a typo.",
    };

  return { valid: true, dateOfBirth };
}

/** YYMMDD → YYYY-MM-DD, or null if it isn't a real date. The century isn't
 *  stored, so 20YY is assumed unless that would be in the future. */
function decodeDateOfBirth(yymmdd: string, today: Date): string | null {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));

  const build = (year: number) => {
    const d = new Date(Date.UTC(year, mm - 1, dd));
    // Date.UTC rolls 31 Feb over into March — reject anything that moved.
    const real =
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === mm - 1 &&
      d.getUTCDate() === dd;
    return real ? d : null;
  };

  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  let d = build(2000 + yy);
  if (d && d.getTime() > todayUtc) d = build(1900 + yy);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Other identity documents — format only.
// ---------------------------------------------------------------------------

export type DocumentKind = "passport" | "asylum" | "refugee" | "other";

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  passport: "Passport",
  asylum: "Asylum-seeker permit",
  refugee: "Refugee permit",
  other: "Other document",
};

// Passport numbers vary by country; permit numbers vary by issuing office
// and year. These only reject what can't possibly be right (empty, too
// short, stray punctuation) — deliberately loose, so a real document is
// never refused because we guessed its format wrong.
const DOCUMENT_FORMATS: Record<DocumentKind, RegExp> = {
  passport: /^[A-Z0-9]{6,12}$/,
  asylum: /^[A-Z0-9/-]{4,25}$/,
  refugee: /^[A-Z0-9/-]{4,25}$/,
  other: /^[A-Z0-9/-]{4,25}$/,
};

export function validateDocumentFormat(
  raw: string,
  kind: DocumentKind,
): IdCheck {
  const value = raw.replace(/\s+/g, "").toUpperCase();
  const label = DOCUMENT_LABELS[kind].toLowerCase();
  if (!value) return { valid: false, reason: `Enter the ${label} number.` };
  if (!DOCUMENT_FORMATS[kind].test(value))
    return {
      valid: false,
      reason:
        kind === "passport"
          ? "A passport number is 6–12 letters and digits, with no spaces or symbols."
          : `That doesn't look like a ${label} number — use letters, digits, "/" or "-" only.`,
    };
  return { valid: true };
}

/** Stored as users.idType. */
export type IdType = "sa_id" | DocumentKind;

export const ID_TYPE_LABELS: Record<IdType, string> = {
  sa_id: "South African ID",
  ...DOCUMENT_LABELS,
};

export function isIdType(value: string): value is IdType {
  return value in ID_TYPE_LABELS;
}

/** Strict for an SA ID, format-only for everything else. */
export function validateIdByType(raw: string, type: IdType): IdCheck {
  return type === "sa_id"
    ? validateSaId(raw)
    : validateDocumentFormat(raw, type);
}

/**
 * For an ID field whose document type wasn't recorded (older records, OCR).
 * 13 digits is treated as an SA ID and checked strictly; anything else gets a
 * format-only check. Known blind spot: a mistyped 12- or 14-digit SA ID is
 * accepted as "other document" — record the type whenever the form can ask.
 */
export function validateUntypedId(raw: string): IdCheck {
  const value = raw.replace(/\s+/g, "");
  return /^\d{13}$/.test(value)
    ? validateSaId(value)
    : validateDocumentFormat(value, "other");
}

// ---------------------------------------------------------------------------
// UI wording — shared so every form describes the same limits the same way.
// ---------------------------------------------------------------------------

export const SA_ID_CHECK_NOTE =
  "We check the date of birth, citizenship digit and check digit. Confirming the number belongs to this person requires Home Affairs verification, a paid service that isn't connected yet.";

export const DOCUMENT_CHECK_NOTE =
  "Passport and permit numbers are checked for format only — we can't verify them without a paid verification service.";

// ---------------------------------------------------------------------------
// KNOWN GAP — Home Affairs verification (deliberately not implemented).
//
// Everything above proves an ID number is well-formed. It cannot prove the
// number was issued, that it belongs to the person in front of reception, or
// that its holder is alive. Only the Department of Home Affairs (DHA) can,
// and access is through paid, contracted providers (e.g. the DHA NPR online
// verification service or a licensed bureau). Nothing is wired up yet.
//
// When a provider is chosen, it plugs in here. It must run server-side (the
// API key cannot ship to the browser) and be called AFTER validateSaId passes,
// so malformed numbers never cost a paid lookup:
//
// export async function verifyWithHomeAffairs(
//   idNumber: string,
//   person: { names: string; surname: string; dateOfBirth: string },
// ): Promise<{
//   verified: boolean;          // DHA holds this ID for this name + DOB
//   deceased?: boolean;         // flagged deceased on the population register
//   reason?: string;            // human-readable, same style as IdCheck.reason
// }>;
//
// Passports and permits would need their own provider(s); none is planned.
// ---------------------------------------------------------------------------
