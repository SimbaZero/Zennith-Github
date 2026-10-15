// Comparing contact details written by different people in different ways.
//
// "082 123 4567", "0821234567" and "+27 82 123 4567" are one phone number, and
// "Thandi@Example.com " is the same address as "thandi@example.com". The
// duplicate check at registration compares keys rather than raw text, and
// registration stores the keys on the user record (emailLower / contactKey) so
// later checks are exact lookups.

/** An e-mail address in its comparable form: trimmed and lower-cased. */
export function emailKey(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 254) : "";
}

/**
 * A phone number in its comparable form. South African numbers (0XXXXXXXXX,
 * 27XXXXXXXXX, +27XXXXXXXXX, 0027…, or nine digits with the 0 left off) all
 * become "27XXXXXXXXX"; anything else is just its digits. Fewer than seven
 * digits isn't a number worth comparing, so it gives "".
 */
export function phoneKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^0\d{9}$/.test(d)) return `27${d.slice(1)}`;
  if (/^27\d{9}$/.test(d)) return d;
  if (/^\d{9}$/.test(d)) return `27${d}`;
  return d.length >= 7 ? d : "";
}

/**
 * The spellings a South African number is likely to have been stored under
 * before keys were kept, for looking up older records. Not exhaustive (a
 * person can type anything); the stored key covers everything from now on.
 */
export function phoneVariants(raw: unknown): string[] {
  const key = phoneKey(raw);
  const typed = typeof raw === "string" ? raw.trim() : "";
  const out = new Set<string>();
  if (typed) out.add(typed);
  if (/^27\d{9}$/.test(key)) {
    const n = key.slice(2); // 821234567
    const a = n.slice(0, 2);
    const b = n.slice(2, 5);
    const c = n.slice(5);
    out.add(`0${n}`);
    out.add(`0${a} ${b} ${c}`);
    out.add(`0${a}-${b}-${c}`);
    out.add(`0${a}${b} ${c}`);
    out.add(`+27${n}`);
    out.add(`27${n}`);
    out.add(`+27 ${a} ${b} ${c}`);
    out.add(`+27 (0)${a} ${b} ${c}`);
    out.add(`0027${n}`);
  } else if (key) {
    out.add(key);
  }
  // Firestore's `in` takes at most 30 values.
  return [...out].slice(0, 30);
}
