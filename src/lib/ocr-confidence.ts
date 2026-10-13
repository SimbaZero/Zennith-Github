// How the quality of a scan is described to the nurse.
//
// The reader reports a rough 0-100 score for its own extraction. That number is
// a guess about itself, not a measured accuracy, so it is never shown: it is
// turned into a plain-language scan-quality label with cautious wording. Nothing
// the person sees mentions how the reading is done, or any score.

export type OcrReadingLevel = "clear" | "mixed" | "poor" | "unknown";

export interface OcrReading {
  level: OcrReadingLevel;
  /** Short phrase for the badge. */
  label: string;
  /** One sentence for the tooltip / screen readers. */
  detail: string;
  /** Whether to draw attention to the check-everything reminder. */
  needsExtraCare: boolean;
}

/** Scores at or above this read as "looks clear"; below it, "some parts may be wrong". */
export const CLEAR_AT = 92;
/** Below this the file reads as "hard to read". */
export const POOR_BELOW = 75;

export function describeOcrConfidence(
  score: number | null | undefined,
): OcrReading {
  if (score == null || !Number.isFinite(score)) {
    return {
      level: "unknown",
      label: "Not assessed",
      detail:
        "The quality of this scan couldn't be assessed. Check every field against the original file.",
      needsExtraCare: true,
    };
  }
  const n = Math.max(0, Math.min(100, Math.round(score)));
  if (n >= CLEAR_AT)
    return {
      level: "clear",
      label: "Looks clear",
      detail:
        "This scan looks clear. Still check every field against the original file before saving.",
      needsExtraCare: false,
    };
  if (n >= POOR_BELOW)
    return {
      level: "mixed",
      label: "Some parts may be unclear",
      detail:
        "Some parts of this scan may be unclear. Check every field against the original file.",
      needsExtraCare: true,
    };
  return {
    level: "poor",
    label: "Hard to read — check carefully",
    detail:
      "This scan is hard to read. Check every field carefully against the original file, or retake the photo.",
    needsExtraCare: true,
  };
}
