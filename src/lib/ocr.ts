// Browser-side OCR for digitising paper patient files.
// tesseract.js is browser-only (spawns web workers + WASM), so it MUST be
// dynamically imported inside a handler — a top-level import breaks the
// server-rendered route on Cloudflare Workers.

export interface OcrResult {
  text: string;
  confidence: number;
}

/** Runs OCR over an image file, reporting 0-100 progress. */
export async function recogniseImage(
  file: File | Blob,
  onProgress?: (pct: number) => void,
): Promise<OcrResult> {
  const { default: Tesseract } = await import("tesseract.js");
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    },
  });
  return { text: data.text ?? "", confidence: data.confidence ?? 0 };
}

export interface ParsedFields {
  fullName: string;
  idNumber: string;
  dob: string;
  cell: string;
  diagnosis: string;
  medication: string;
  notes: string;
}

/** Pulls a labelled value out of OCR text: "Full Name: Jane Doe". */
function labelled(text: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*(.+)`, "i");
    const line = text.split(/\r?\n/).find((l) => re.test(l));
    if (line) {
      const m = line.match(re);
      const v = m?.[1]?.trim();
      if (v) return v.replace(/\s{2,}/g, " ");
    }
  }
  return "";
}

/**
 * Best-effort extraction of clinic-file fields from raw OCR text.
 * Falls back to pattern matching (13-digit SA ID, phone, date) when the
 * expected labels are missing or were misread.
 */
export function parsePatientFile(text: string): ParsedFields {
  const compact = text.replace(/[|]/g, "");

  const idPattern = compact.match(/\b(\d[\d\s]{11,15}\d)\b/);
  const idNumber =
    labelled(compact, ["id number", "id no", "identity"]).replace(/\D/g, "").slice(0, 13) ||
    (idPattern ? idPattern[1].replace(/\D/g, "").slice(0, 13) : "");

  const cellPattern = compact.match(/\b(0\d{2}[\s-]?\d{3}[\s-]?\d{4})\b/);
  const cell =
    labelled(compact, ["cell", "phone", "contact", "tel", "mobile"]) ||
    (cellPattern ? cellPattern[1] : "");

  const dobPattern = compact.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/);
  const dob =
    labelled(compact, ["date of birth", "dob", "born"]) || (dobPattern ? dobPattern[1] : "");

  return {
    fullName: labelled(compact, ["full name", "patient name", "name", "surname"]),
    idNumber,
    dob,
    cell,
    diagnosis: labelled(compact, ["diagnosis", "condition", "chronic condition", "problem"]),
    medication: labelled(compact, ["medication", "current medication", "prescription", "treatment", "regimen"]),
    // whatever follows a Notes/Remarks label, else the tail of the document
    notes:
      labelled(compact, ["notes", "remarks", "comments", "history"]) ||
      compact.split(/\r?\n/).filter((l) => l.trim().length > 25).slice(-1)[0]?.trim() ||
      "",
  };
}

/** Confidence below this is flagged for human review in the UI. */
export const REVIEW_THRESHOLD = 85;
