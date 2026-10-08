// A clinic id is a number in every record the app writes — but a document edited
// by hand in the Firebase console ends up with the string "1" instead, because
// the console's field editor defaults to string. Firestore equality is
// type-strict, so a query for the number 1 never matches "1": that patient is
// simply absent from the list, with no error anywhere.
//
// These two helpers are the one place that tolerance lives, so a query and an
// in-memory check treat the two forms the same way.

/**
 * Every form a stored clinic id might take, for building a query per form.
 * 1 → [1, "1"]; "1" → [1, "1"]. Something that isn't a number (a stray
 * "hillbrow") is returned as-is, so it can still match itself exactly.
 */
export function clinicIdVariants(
  id: number | string | null | undefined,
): (number | string)[] {
  if (id == null || id === "") return [];
  const n = Number(id);
  if (!Number.isFinite(n)) return [id];
  return [n, String(n)];
}

/** Do these two clinic ids mean the same clinic, whichever form each is in? */
export function sameClinicId(a: unknown, b: unknown): boolean {
  if (a == null || b == null || a === "" || b === "") return false;
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}
