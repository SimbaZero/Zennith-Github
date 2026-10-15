import {
  collection,
  getDocs,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/firebase";
import { emailKey, phoneKey, phoneVariants } from "@/lib/contact-key";

// "Is this e-mail / phone number already registered to a patient?"
//
// Used live while reception types a registration, and again when they submit.
// It only looks at patients' user records (staff share nothing with patients
// here), and it reports yes/no per value - never who - so the warning can't be
// used to read someone else's details.

export interface ContactCheckResult {
  /** Is the e-mail address already on another patient's record? */
  email: boolean;
  /** For each phone number asked about (as typed): is it already on another patient's record? */
  phones: Record<string, boolean>;
}

/** Roles in `users.role` that are staff, whose contact details don't count. */
const STAFF_ROLES = new Set([
  "nurse",
  "doctor",
  "pharmacist",
  "receptionist",
  "admin",
  "super_admin",
]);

function isOtherPatient(
  d: QueryDocumentSnapshot,
  excludeUserId: string | undefined,
): boolean {
  if (excludeUserId && d.id === excludeUserId) return false;
  const role = String(d.data().role ?? "").toLowerCase();
  return !STAFF_ROLES.has(role);
}

/**
 * Looks up `email` and each of `phones` among existing patients. `excludeUserId`
 * is a user record to ignore (the patient being edited, so their own details
 * don't count as "already registered"). Throws if the database can't be
 * reached; the caller treats that as "couldn't check", not "not in use".
 */
export async function checkContactInUse(input: {
  email?: string;
  phones?: string[];
  excludeUserId?: string | number | null;
}): Promise<ContactCheckResult> {
  const exclude =
    input.excludeUserId != null ? String(input.excludeUserId) : undefined;
  const result: ContactCheckResult = { email: false, phones: {} };

  const users = collection(db, "users");
  const jobs: Promise<void>[] = [];

  const email = emailKey(input.email);
  if (email) {
    jobs.push(
      (async () => {
        const typed = (input.email ?? "").trim();
        const queries = [
          getDocs(query(users, where("emailLower", "==", email))),
          // Records from before the key was stored hold the address as typed.
          getDocs(
            query(
              users,
              where("email", "in", [...new Set([typed, email])].slice(0, 30)),
            ),
          ),
        ];
        const snaps = await Promise.all(queries);
        result.email = snaps.some((s) =>
          s.docs.some((d) => isOtherPatient(d, exclude)),
        );
      })(),
    );
  }

  for (const phone of input.phones ?? []) {
    const key = phoneKey(phone);
    if (!key) continue;
    jobs.push(
      (async () => {
        const snaps = await Promise.all([
          getDocs(query(users, where("contactKey", "==", key))),
          getDocs(
            query(users, where("contactNum", "in", phoneVariants(phone))),
          ),
        ]);
        result.phones[phone] = snaps.some((s) =>
          s.docs.some((d) => isOtherPatient(d, exclude)),
        );
      })(),
    );
  }

  await Promise.all(jobs);
  return result;
}

/**
 * What the registration form should do about a check result.
 *   "block": the e-mail AND a phone number are both already registered, which is
 *            almost certainly the same person being registered twice.
 *   "warn":  one of them is, which is allowed (a parent and child can share a
 *            number), but worth a look.
 *   "clear": neither is.
 */
export function contactCheckVerdict(
  entered: { email: string; phones: string[] },
  found: ContactCheckResult,
): "block" | "warn" | "clear" {
  const emailGiven = !!emailKey(entered.email);
  const phonesGiven = entered.phones.filter((p) => !!phoneKey(p));
  const emailHit = emailGiven && found.email;
  const phoneHit = phonesGiven.some((p) => found.phones[p]);
  if (emailGiven && phonesGiven.length > 0 && emailHit && phoneHit)
    return "block";
  return emailHit || phoneHit ? "warn" : "clear";
}
