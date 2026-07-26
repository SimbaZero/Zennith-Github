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
import { db } from "@/lib/firebase";
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
  avgDay: number; // average units used per day — see TODO below, this is currently faked
}

interface RawInventoryDoc {
  medName?: string;
  quantity?: number | string; // TODO(db): sometimes a string in Firestore — see db-issues.md #1
  threshold?: number | string;
  inventId?: number;
  category?: string;
  lastUpdated?: string;
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
