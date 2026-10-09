// Server-only: the patient "Find a medication" search.
//
// A patient's browser can't read the `inventory` collection: firestore.rules
// keeps it staff-only, because it holds every clinic's real stock levels and
// supplier data. Searching it from the patient page therefore always came
// back permission-denied, and the page treated that as "live stock is
// unavailable" and switched the search box off.
//
// This answers the one question a patient is entitled to ask - "is this in
// stock at MY clinic?" - without opening the collection. The caller is
// identified by their Firebase ID token, their clinic is taken from their own
// patient record (never from the request), and only a name, a category and an
// in-stock yes/no go back - no unit counts, thresholds or other clinics.
import { clinicIdVariants } from "../lib/clinic-id";
import type { StockSearchResult } from "../lib/stock-search";
import { verifyIdToken } from "./firebase-auth";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
} from "./firestore-admin";

const MAX_RESULTS = 6;
const MIN_TERM = 2;
const MAX_TERM = 60;

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

export async function searchClinicStock(
  idToken: unknown,
  rawTerm: unknown,
  env?: unknown,
): Promise<StockSearchResult> {
  if (normaliseTerm(rawTerm).length < MIN_TERM)
    return { ok: true, clinicLinked: true, items: [] };

  const fs = adminOrNull(env);
  if (!fs) return { ok: false, reason: "not-configured" };

  const uid = await verifyIdToken(idToken, fs.projectId);
  if (!uid) return { ok: false, reason: "unauthenticated" };

  return findClinicStock(fs, uid, rawTerm);
}

function normaliseTerm(raw: unknown): string {
  return typeof raw === "string"
    ? raw.trim().toLowerCase().slice(0, MAX_TERM)
    : "";
}

/** The part after the caller is known: their clinic's stock matching `rawTerm`. */
export async function findClinicStock(
  fs: Pick<FirestoreAdmin, "get" | "query">,
  uid: string,
  rawTerm: unknown,
): Promise<StockSearchResult> {
  const term = normaliseTerm(rawTerm);
  if (term.length < MIN_TERM)
    return { ok: true, clinicLinked: true, items: [] };

  const profile = (await fs.get("profiles", uid))?.data;
  // Patients only: staff have their own stock pages and the real numbers.
  if (!profile || profile.role !== "patient")
    return { ok: false, reason: "not-eligible" };

  const patientId =
    typeof profile.patientId === "string" ? profile.patientId : "";
  const patient = patientId
    ? (await fs.get("patients", patientId))?.data
    : null;
  const clinicIds = clinicIdVariants(
    patient?.clinicId as number | string | null | undefined,
  );
  if (clinicIds.length === 0)
    return { ok: true, clinicLinked: false, items: [] };

  // clinicId is stored as a number on most documents and a string on some, so
  // both spellings are asked for.
  const rows = await fs.query("inventory", [
    { field: "clinicId", op: "IN", value: clinicIds },
  ]);

  const items = rows
    .filter((r) => {
      const name = String(r.data.medName ?? "").toLowerCase();
      const category = String(r.data.category ?? "").toLowerCase();
      return name.includes(term) || category.includes(term);
    })
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      name: String(r.data.medName ?? "Unknown medication"),
      category:
        typeof r.data.category === "string" ? r.data.category : undefined,
      // quantity is sometimes stored as a string; Number() copes with both.
      inStock: Number(r.data.quantity) > 0,
    }));

  return { ok: true, clinicLinked: true, items };
}
