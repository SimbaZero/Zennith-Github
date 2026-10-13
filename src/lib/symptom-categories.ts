// A small, fixed lookup from everyday symptom words to the CATEGORIES of
// medicine a clinic stocks.
//
// This is deliberately not a diagnosis tool and says nothing about what anyone
// should take. It maps a word a patient might type ("headache") onto a stock
// category name so the existing "what's in stock" search can show that part of
// the shelf. Hence, by design, this file contains:
//   - no medicine names,
//   - no doses or quantities,
//   - no advice about treatment.
// A category is a class of product ("Analgesic"), not a recommendation.
//
// `categories` are the lower-cased category names the clinics' stock actually
// uses, plus the plain-language ones, matched as substrings of a stock item's
// category. The patient sees `label`, never these.

export interface SymptomGroup {
  /** Plain-language name shown to the patient. */
  label: string;
  /** Words a patient might type. Matched as whole words, plurals included. */
  symptoms: readonly string[];
  /** Stock-category names (lower case) this group points at. */
  categories: readonly string[];
}

export const SYMPTOM_GROUPS: readonly SymptomGroup[] = [
  {
    label: "Pain relief",
    symptoms: [
      "headache",
      "head ache",
      "migraine",
      "fever",
      "temperature",
      "pain",
      "ache",
      "toothache",
      "backache",
      "back pain",
      "body ache",
      "muscle pain",
      "period pain",
      "cramps",
    ],
    categories: ["analgesic", "antipyretic", "pain relief", "pain"],
  },
  {
    label: "Cough & cold",
    symptoms: [
      "cough",
      "cold",
      "flu",
      "sore throat",
      "runny nose",
      "blocked nose",
      "stuffy nose",
      "sneezing",
      "congestion",
    ],
    categories: [
      "cough",
      "cold",
      "decongestant",
      "expectorant",
      "antihistamine",
    ],
  },
  {
    label: "Allergy",
    symptoms: [
      "allergy",
      "allergies",
      "hay fever",
      "itching",
      "itchy",
      "hives",
      "rash",
    ],
    categories: ["antihistamine", "allergy"],
  },
  {
    label: "Stomach & digestion",
    symptoms: [
      "nausea",
      "vomiting",
      "diarrhoea",
      "diarrhea",
      "stomach ache",
      "stomach pain",
      "indigestion",
      "heartburn",
      "constipation",
    ],
    categories: [
      "antiemetic",
      "antidiarrhoeal",
      "antacid",
      "rehydration",
      "laxative",
      "digestive",
    ],
  },
] as const;

/** Shown, unchanged, whenever a symptom word has been used for the search. */
export const SYMPTOM_DISCLAIMER =
  "This is a general category match, not medical advice — please consult clinic staff.";

export interface SymptomMatch {
  /** The group's patient-facing name, e.g. "Pain relief". */
  label: string;
  /** The word(s) from the group that the patient typed. */
  matched: string[];
  /** Stock-category names to search, de-duplicated across every group hit. */
  categories: string[];
  /** Every group's label that matched, in order (a search can touch several). */
  labels: string[];
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds symptom words in what was typed. Matching is by whole word (so "pain"
 * doesn't fire inside "painting"), tolerates a trailing "s"/"es" ("headaches"),
 * ignores case and extra spaces, and works inside a sentence ("I have a
 * headache"). Returns null when nothing matches, in which case the caller just
 * runs the ordinary name/category search.
 */
export function matchSymptom(text: string): SymptomMatch | null {
  const t = ` ${String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  if (t.trim().length < 2) return null;
  const matched: string[] = [];
  const labels: string[] = [];
  const categories: string[] = [];
  for (const g of SYMPTOM_GROUPS) {
    const hits = g.symptoms.filter((s) =>
      new RegExp(`\\s${escapeRegExp(s)}(?:e?s)?\\s`).test(t),
    );
    if (hits.length === 0) continue;
    matched.push(...hits);
    labels.push(g.label);
    for (const c of g.categories)
      if (!categories.includes(c)) categories.push(c);
  }
  if (labels.length === 0) return null;
  return { label: labels.join(" / "), matched, categories, labels };
}
