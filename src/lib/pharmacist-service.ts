import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  addDoc,
  orderBy,
  limit,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { stock as mockStock } from "@/lib/data";

// Shape the existing UI already expects (see pharmacist.index.tsx, pharmacist.stock.tsx).
// Real Firestore `inventory` docs use different field names (medName, quantity) —
// this maps them into the shape the UI already knows how to render.
export interface StockItem {
  docId?: string; // the real Firestore document ID — needed to write updates back (absent on mock/fallback data)
  name: string;
  units: number;
  threshold: number;
  inventId?: number;
  category?: string;
  lastUpdated?: string;
  clinicId?: number; // NEW — which clinic this stock belongs to (mock/fallback items won't have one)
  avgDay: number; // average units used per day — see TODO below, this is currently faked
}

interface RawInventoryDoc {
  medName?: string;
  quantity?: number | string; // TODO(db): sometimes a string in Firestore — see db-issues.md #1
  threshold?: number | string;
  inventId?: number;
  category?: string;
  lastUpdated?: string;
  clinicId?: number;
}
// Firestore sometimes returns quantity/threshold as strings — this forces them
// into real numbers no matter what type Firestore gives us, so math never breaks.
function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapInventoryDoc(id: string, data: RawInventoryDoc): StockItem {
  return {
    docId: id,
    name: data.medName ?? "Unknown medication",
    units: toNumber(data.quantity),
    threshold: toNumber(data.threshold),
    inventId: data.inventId,
    category: data.category,
    lastUpdated: data.lastUpdated,
    clinicId: data.clinicId,
    // TODO(db): `avgDay` (average daily usage) does not exist in Firestore yet.
    // Faking it here as threshold/5 just so the UI has a plausible-looking number.
    // See db-issues.md #3 — needs a real decision: stored field vs. calculated
    // from `distributions` history.
    avgDay: Math.max(1, Math.round(toNumber(data.threshold) / 5)),
  };
}

/**
 * Live-subscribes to the real `inventory` collection in Firestore.
 * Falls back to the existing mock stock data if the read fails
 * (e.g. permission denied, no auth yet, offline) so the dashboard
 * never breaks or shows blank while the backend is still being built.
 */
export function useInventory(): {
  stock: StockItem[];
  loading: boolean;
  usingFallback: boolean;
} {
  const [stock, setStock] = useState<StockItem[]>(mockStock);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "inventory"),
      (snapshot) => {
        const items = snapshot.docs.map((d) => mapInventoryDoc(d.id, d.data()));
        setStock(items);
        setUsingFallback(false);
        setLoading(false);
      },
      (err) => {
        // Permission denied, offline, etc. — fall back to mock data so the UI still works.
        console.warn("Falling back to mock stock data:", err.message);
        setStock(mockStock);
        setUsingFallback(true);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  return { stock, loading, usingFallback };
}

/**
 * Real write: increases a medication's quantity in Firestore by `amount`.
 *
 * Deliberately NOT using Firestore's increment() helper here — because we
 * know (see db-issues.md #1) that `quantity` is sometimes stored as a STRING
 * in this collection, and increment() on a non-number field silently
 * overwrites it instead of adding to it. Reading first and writing an
 * explicit, correctly-typed number sidesteps that entirely.
 *
 * Requires a real docId — call this only on items loaded from useInventory(),
 * not on mock/fallback items (their docId will be undefined).
 */
export async function addInventoryStock(
  docId: string,
  amount: number,
): Promise<void> {
  if (!docId)
    throw new Error("Cannot write stock update: missing Firestore document ID");

  const ref = doc(db, "inventory", docId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Medication not found in inventory");

  const current = toNumber(snap.data().quantity);
  const newQuantity = current + amount;

  await updateDoc(ref, {
    quantity: newQuantity, // always written as a real number, fixing the bad data as we go
    lastUpdated: new Date().toISOString(),
  });
}

export interface Nurse {
  docId: string; // real Firestore document ID
  nurseId: string; // e.g. "Nur-1"
  specialisation?: string;
}

/**
 * Looks up the real nurses assigned to a given clinic.
 * Two-step lookup because of how the schema is linked (see db-issues.md #6):
 *   1. Find the clinic's real numeric clinicId by matching its name.
 *   2. Find all nurses whose clinicId matches that number.
 * This is a one-time fetch (not live) — good enough for populating a dropdown.
 */
export async function getNursesForClinic(clinicName: string): Promise<Nurse[]> {
  const clinicsSnap = await getDocs(
    query(collection(db, "clinics"), where("clinicName", "==", clinicName)),
  );
  if (clinicsSnap.empty) return [];
  const clinicId = clinicsSnap.docs[0].data().clinicId;

  const nursesSnap = await getDocs(
    query(collection(db, "nurses"), where("clinicId", "==", clinicId)),
  );
  return nursesSnap.docs.map((d) => ({
    docId: d.id,
    nurseId: d.data().nurseId,
    specialisation: d.data().specialisation,
  }));
}

/**
 * Records a completed distribution: pharmacist gives `unitsGiven` of a
 * medication to a specific nurse. Does two things together:
 *   1. Writes a new record to the real `distributions` collection.
 *   2. Deducts the given amount from the medication's real inventory quantity.
 *
 * Note: these two writes are not wrapped in a single atomic transaction —
 * acceptable for now, but worth knowing (see db-issues.md) if this needs to
 * be bulletproof against concurrent pharmacists later.
 */
export async function recordDistribution(params: {
  inventoryDocId: string;
  medName: string;
  nurseId: string;
  unitsGiven: number;
}): Promise<void> {
  const { inventoryDocId, medName, nurseId, unitsGiven } = params;
  if (unitsGiven <= 0) throw new Error("Units given must be greater than 0");

  // 1. Write the distribution record.
  // TODO(db): distributionId uses Date.now() as a placeholder — see db-issues.md #4,
  // there's no real sequential counter for distributions yet.
  await addDoc(collection(db, "distributions"), {
    distributionId: Date.now(),
    medName,
    nurseName: nurseId,
    unitsGiven,
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  });

  // 2. Deduct from real inventory (same safe read-then-write pattern as addInventoryStock).
  await addInventoryStock(inventoryDocId, -unitsGiven);
}

export interface DistributionRecord {
  docId: string;
  medName: string;
  nurseName: string;
  unitsGiven: number;
  date: string;
}

/**
 * Live-subscribes to the most recent real distribution records, newest first.
 * Used to show an up-to-date "recent distributions" list without needing a refresh.
 */
export function useRecentDistributions(max = 20): DistributionRecord[] {
  const [records, setRecords] = useState<DistributionRecord[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, "distributions"),
      orderBy("createdAt", "desc"),
      limit(max),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRecords(
        snapshot.docs.map((d) => ({
          docId: d.id,
          medName: d.data().medName,
          nurseName: d.data().nurseName,
          unitsGiven: d.data().unitsGiven,
          date: d.data().date,
        })),
      );
    });
    return () => unsubscribe();
  }, [max]);

  return records;
}

export interface PatientDirectoryEntry {
  patientId: string; // e.g. "Pat-1" — also the Firestore doc ID
  fullName: string;
  medicalRecordNo?: number;
  chronicCondition?: string;
}

/**
 * Loads a searchable patient directory by joining `patients` + `users` in
 * memory. Patients don't store a name directly (schema links them to
 * `users` by a numeric userId) — this does two collection reads total,
 * then joins them, rather than one read per patient.
 */
export function usePatientDirectory(): {
  patients: PatientDirectoryEntry[];
  loading: boolean;
} {
  const [patients, setPatients] = useState<PatientDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [patientsSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, "patients")),
          getDocs(collection(db, "users")),
        ]);

        // Build a quick lookup: userId (number) -> full name.
        const userNameById = new Map<number, string>();
        usersSnap.docs.forEach((d) => {
          const u = d.data();
          userNameById.set(
            u.userId,
            `${u.names ?? ""} ${u.surname ?? ""}`.trim(),
          );
        });

        const joined: PatientDirectoryEntry[] = patientsSnap.docs.map((d) => {
          const p = d.data();
          return {
            patientId: p.patientId ?? d.id,
            fullName: userNameById.get(p.userId) || "Unknown patient",
            medicalRecordNo: p.medicalRecordNo,
            chronicCondition: p.chronicCondition,
          };
        });

        if (!cancelled) {
          setPatients(joined);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load patient directory:", err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { patients, loading };
}

/**
 * Fetches just the prescription text for a patient, by their medicalRecordNo.
 * Deliberately returns ONLY the prescription — not allergies, blood pressure,
 * glucose, etc. — matching the existing UI's privacy design (pharmacists see
 * what to dispense, not the patient's full clinical history).
 */
export async function getPrescriptionForPatient(
  medicalRecordNo: number,
): Promise<string | null> {
  const snap = await getDoc(doc(db, "medicalRecords", String(medicalRecordNo)));
  if (!snap.exists()) return null;
  return snap.data().prescription ?? null;
}

/**
 * Live-computes a real 7-day dispensing trend per medication, from actual
 * `distributions` records — replaces the old fake/random sparkline data.
 *
 * Note: this measures "units dispensed per day" (usage rate), not "units on
 * hand per day" like the old fake version did — a rising trend now means
 * consumption is speeding up (useful for spotting meds that'll run out
 * sooner than expected), which is arguably a more useful predictive signal
 * anyway. If a medication has no distribution activity in the last 7 days,
 * its trend will correctly show as flat zero — that's real data, not a bug,
 * though it may look sparse until more distributions have been recorded.
 */
export function useMedicationDispenseTrends(): Record<string, number[]> {
  const [trends, setTrends] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "distributions"),
      (snapshot) => {
        // Build the last 7 calendar days (oldest first, today last).
        const days: string[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          days.push(d.toISOString().slice(0, 10));
        }

        const byMed: Record<string, number[]> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const medName = data.medName as string;
          const date = data.date as string;
          const units = toNumber(data.unitsGiven);
          const dayIndex = days.indexOf(date);
          if (dayIndex === -1) return; // outside the last 7 days

          if (!byMed[medName]) byMed[medName] = new Array(7).fill(0);
          byMed[medName][dayIndex] += units;
        });

        setTrends(byMed);
      },
    );

    return () => unsubscribe();
  }, []);

  return trends;
}

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for "who is the current pharmacist".
// Mirrors useCurrentDoctor() / useCurrentNurse() — built multi-clinic-aware
// from the start, since Pharmacist had no identity resolution at all before
// this, nothing old to preserve here.
// ---------------------------------------------------------------------------

export interface CurrentPharmacist {
  pharmacistId: string; // e.g. "Pharm-1"
  userId?: number;
  clinicId?: number; // currently-active clinic — first entry of clinicIds
  clinicIds?: number[]; // every clinic this pharmacist belongs to
  clinicName?: string;
  fullName: string;
  email?: string;
  contactNum?: string;
  licenseNo?: string;
}

const pharmacistCacheByUid = new Map<string, Promise<CurrentPharmacist>>();

async function resolveCurrentPharmacistForUid(
  uid: string,
): Promise<CurrentPharmacist> {
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists()
    ? profileSnap.data()
    : ({} as Record<string, any>);

  if (profile.legacyUserId == null) {
    throw new Error(
      "Your staff profile has no linked pharmacist record — contact whoever set up your account.",
    );
  }

  const pharmSnap = await getDocs(
    query(
      collection(db, "pharmacists"),
      where("userId", "==", Number(profile.legacyUserId)),
    ),
  );
  if (pharmSnap.empty) {
    throw new Error(
      "Your staff profile has no linked pharmacist record — contact whoever set up your account.",
    );
  }

  const pharmData = pharmSnap.docs[0].data();
  return buildCurrentPharmacist(pharmData.pharmacistId, pharmData);
}

async function buildCurrentPharmacist(
  pharmacistId: string,
  pharmacistData: Record<string, any>,
): Promise<CurrentPharmacist> {
  let fullName = pharmacistId;
  let email: string | undefined;
  let contactNum: string | undefined;

  if (pharmacistData.userId != null) {
    const uSnap = await getDoc(doc(db, "users", String(pharmacistData.userId)));
    if (uSnap.exists()) {
      const u = uSnap.data();
      fullName = [u.names, u.surname].filter(Boolean).join(" ") || pharmacistId;
      email = u.email;
      contactNum = u.contactNum;
    }
  }

  const clinicIds: number[] = Array.isArray(pharmacistData.clinicIds)
    ? pharmacistData.clinicIds
    : pharmacistData.clinicId != null
      ? [pharmacistData.clinicId]
      : [];
  const activeClinicId = clinicIds[0];

  let clinicName: string | undefined;
  if (activeClinicId != null) {
    const cSnap = await getDoc(doc(db, "clinics", String(activeClinicId)));
    if (cSnap.exists()) clinicName = cSnap.data().clinicName;
  }

  return {
    pharmacistId,
    userId: pharmacistData.userId,
    clinicId: activeClinicId,
    clinicIds,
    clinicName,
    fullName,
    email,
    contactNum,
    licenseNo: pharmacistData.licenseNo,
  };
}

/**
 * Not wired into any pharmacist page yet — that's the next step. This just
 * makes the capability exist, same shape as useCurrentDoctor().
 */
export function useCurrentPharmacist(): {
  pharmacist: CurrentPharmacist | null;
  loading: boolean;
  error: string | null;
} {
  const [pharmacist, setPharmacist] = useState<CurrentPharmacist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (!cancelled) {
          setPharmacist(null);
          setError("Not signed in");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      if (!pharmacistCacheByUid.has(user.uid)) {
        pharmacistCacheByUid.set(
          user.uid,
          resolveCurrentPharmacistForUid(user.uid),
        );
      }

      pharmacistCacheByUid
        .get(user.uid)!
        .then((p) => {
          if (!cancelled) {
            setPharmacist(p);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to resolve current pharmacist:", err);
          pharmacistCacheByUid.delete(user.uid);
          if (!cancelled) {
            setError(err.message ?? "Could not load pharmacist profile");
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { pharmacist, loading, error };
}
