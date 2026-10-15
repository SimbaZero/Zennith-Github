// Patient IDs are stored as "Pat-828", and a patient's document is looked up by
// that exact string. People type them every way: "pat-828", "PAT-828", "Pat 828",
// "pat828". Anything that takes a patient ID typed by a person goes through here
// first, so the capitalisation (or a missing hyphen) can never be the reason a
// patient "isn't found".

/**
 * The canonical "Pat-<number>" for something that is clearly a patient ID, or
 * null when it isn't one (a name, a partial, an ID in some other format).
 * Case-insensitive; accepts a hyphen, a space, an underscore or nothing between
 * the prefix and the number.
 */
export function canonicalPatientId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*pat[\s_-]*0*(\d{1,12})\s*$/i.exec(raw);
  return m ? `Pat-${m[1]}` : null;
}

/**
 * The ID to use for a lookup: canonical when it reads as a patient ID, otherwise
 * the text trimmed and left as it is (so an unusual stored format still works).
 */
export function normalisePatientId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return canonicalPatientId(raw) ?? raw.trim();
}
