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
import {
  notifyClinicAdmins,
  notifyRoleAtClinic,
  notifyUser,
  userIdForStaff,
} from "@/lib/notify";

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

// ---------------------------------------------------------------------------
// Stock deliveries: pharmacy → clinic.
//
// The `stockDeliveries` collection already existed in the schema with exactly
// the right fields (sentByPharmacistId, confirmedByNurseId, clinicId, items,
// status) but nothing in the app ever used it. This wires it up.
//
// The rule that matters: stock exists in exactly ONE place at a time.
//   - Sending deducts from the pharmacy immediately (it left the shelf).
//   - The clinic does NOT gain it until a nurse confirms arrival.
// So stock in transit belongs to neither, which is the honest state.
// ---------------------------------------------------------------------------

export interface DeliveryItem {
  inventoryDocId: string; // pharmacy's inventory doc it came out of
  name: string;
  quantity: number;
}

export interface StockDelivery {
  id: string;
  clinicId: number;
  items: DeliveryItem[];
  status: "Pending" | "Confirmed" | "Rejected";
  sentByPharmacistId: string;
  sentAt: string;
  confirmedByNurseId?: string | null;
  confirmedAt?: string | null;
  note?: string;
  /** Set when received quantities didn't match what was sent. */
  hasDiscrepancy?: boolean;
  discrepancies?: { name: string; sent: number; received: number }[];
  discrepancyNote?: string;
  rejectionReason?: string;
  externalSource?: string;
}

/**
 * Sends a delivery to a clinic and deducts the stock from the pharmacy now.
 * Rejects the whole thing if any line would take stock negative, rather than
 * sending a partial delivery the pharmacy can't actually fulfil.
 */
export async function sendStockDelivery(input: {
  clinicId: number;
  pharmacistId: string;
  items: DeliveryItem[];
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (input.items.length === 0)
    return { ok: false, error: "Add at least one medication." };

  // Check everything is available BEFORE writing anything.
  for (const item of input.items) {
    const snap = await getDoc(doc(db, "inventory", item.inventoryDocId));
    if (!snap.exists())
      return { ok: false, error: `${item.name} is no longer in inventory.` };
    const available = toNumber(snap.data().quantity);
    if (item.quantity > available)
      return {
        ok: false,
        error: `Only ${available} of ${item.name} in stock — can't send ${item.quantity}.`,
      };
  }

  await addDoc(collection(db, "stockDeliveries"), {
    clinicId: input.clinicId,
    items: input.items.map((i) => ({
      inventoryDocId: i.inventoryDocId,
      name: i.name,
      quantity: i.quantity,
    })),
    status: "Pending",
    sentByPharmacistId: input.pharmacistId,
    // Older seeded rows used `createdAt` — write both so old and new
    // deliveries read consistently instead of showing "Invalid date".
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    confirmedByNurseId: null,
    confirmedAt: null,
    ...(input.note ? { note: input.note } : {}),
  });

  // Deduct from the pharmacy — the stock has physically left.
  for (const item of input.items) {
    await addInventoryStock(item.inventoryDocId, -item.quantity);
  }

  // Tell the clinic's nurses something is on the way. Any of them can
  // receive it, so it goes to all of them rather than one named person.
  notifyRoleAtClinic({
    role: "nurses",
    clinicId: input.clinicId,
    title: "Stock delivery on the way",
    message: `${input.items.length} medication${input.items.length === 1 ? "" : "s"} sent from the pharmacy — confirm when it arrives.`,
    link: "/nurse/stock",
  });

  return { ok: true };
}

/** Live deliveries for one clinic (nurse's view) or one pharmacy (sent history). */
export function useStockDeliveries(
  clinicId?: number,
  statusFilter?: StockDelivery["status"],
): { deliveries: StockDelivery[]; loading: boolean } {
  const [deliveries, setDeliveries] = useState<StockDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (clinicId == null) {
      setDeliveries([]);
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, "stockDeliveries"),
      where("clinicId", "==", clinicId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as StockDelivery,
        );
        if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
        // Seeded rows use createdAt (a Firestore Timestamp), ours use sentAt
        // (an ISO string). Normalise so both display and sort correctly.
        rows = rows.map((r) => {
          const raw = (r as any).sentAt ?? (r as any).createdAt;
          const iso =
            typeof raw === "string"
              ? raw
              : raw?.toDate?.()
                ? raw.toDate().toISOString()
                : new Date().toISOString();
          return { ...r, sentAt: iso };
        });
        rows.sort(
          (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
        );
        setDeliveries(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Stock deliveries subscription failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [clinicId, statusFilter]);

  return { deliveries, loading };
}

/**
 * Nurse confirms a delivery arrived. `receivedItems` lets them correct the
 * quantities — pharmacy sends 200, 180 actually arrives — because that's what
 * really happens, and silently accepting the sent figure would put the
 * clinic's stock permanently out of step with the shelf.
 */
export async function confirmStockDelivery(input: {
  deliveryId: string;
  nurseId: string;
  clinicId: number;
  receivedItems: { name: string; quantity: number }[];
  /** Required when received quantities differ from what was sent. */
  discrepancyNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ref = doc(db, "stockDeliveries", input.deliveryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, error: "Delivery not found." };
  if (snap.data().status !== "Pending")
    return { ok: false, error: "This delivery was already handled." };

  // Add each received medication to the CLINIC's own inventory row, creating
  // it if this clinic has never stocked that medication before.
  for (const item of input.receivedItems) {
    if (item.quantity <= 0) continue;
    const existing = await getDocs(
      query(
        collection(db, "inventory"),
        where("clinicId", "==", input.clinicId),
        where("medName", "==", item.name),
      ),
    );
    if (existing.empty) {
      await addDoc(collection(db, "inventory"), {
        medName: item.name,
        quantity: item.quantity,
        threshold: 0,
        clinicId: input.clinicId,
        category: "Delivered",
        lastUpdated: new Date().toISOString(),
      });
    } else {
      await addInventoryStock(existing.docs[0].id, item.quantity);
    }
  }

  // Work out exactly which lines came up short or over, so the pharmacy can
  // see the difference instead of it being silently absorbed into stock.
  const sentItems = (snap.data().items ?? []) as DeliveryItem[];
  const discrepancies = sentItems
    .map((sent) => {
      const got =
        input.receivedItems.find((r) => r.name === sent.name)?.quantity ?? 0;
      return { name: sent.name, sent: sent.quantity, received: got };
    })
    .filter((d) => d.sent !== d.received);

  await updateDoc(ref, {
    status: "Confirmed",
    confirmedByNurseId: input.nurseId,
    confirmedAt: new Date().toISOString(),
    receivedItems: input.receivedItems,
    hasDiscrepancy: discrepancies.length > 0,
    discrepancies,
    ...(input.discrepancyNote
      ? { discrepancyNote: input.discrepancyNote }
      : {}),
  });

  // Close the loop back to whoever sent it.
  const senderId = snap.data().sentByPharmacistId as string | null;
  if (senderId) {
    const uid = await userIdForStaff("pharmacists", senderId);
    if (uid != null) {
      await notifyUser({
        userId: uid,
        title:
          discrepancies.length > 0
            ? "Delivery received — amounts didn't match"
            : "Delivery confirmed",
        message:
          discrepancies.length > 0
            ? `${discrepancies.map((d) => `${d.name}: sent ${d.sent}, got ${d.received}`).join("; ")}${input.discrepancyNote ? ` — "${input.discrepancyNote}"` : ""}`
            : `All items received in full by ${input.nurseId}.`,
        link: "/pharmacist/deliveries",
      });
    }
  }

  return { ok: true };
}

/** Nurse rejects a delivery outright — nothing is added to clinic stock. */
export async function rejectStockDelivery(
  deliveryId: string,
  nurseId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const ref = doc(db, "stockDeliveries", deliveryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, error: "Delivery not found." };
  if (snap.data().status !== "Pending")
    return { ok: false, error: "This delivery was already handled." };

  await updateDoc(ref, {
    status: "Rejected",
    confirmedByNurseId: nurseId,
    confirmedAt: new Date().toISOString(),
    rejectionReason: reason,
  });

  const senderId = snap.data().sentByPharmacistId as string | null;
  if (senderId) {
    const uid = await userIdForStaff("pharmacists", senderId);
    if (uid != null) {
      await notifyUser({
        userId: uid,
        title: "Delivery rejected",
        message: `${nurseId} rejected the delivery: ${reason}`,
        link: "/pharmacist/deliveries",
      });
    }
  }
  return { ok: true };
}

/**
 * Fallback for when the supplying pharmacy doesn't use Zennith: a nurse
 * records stock that physically arrived from outside the system.
 *
 * Deliberately no approval step — the stock is already in the room, and
 * requiring sign-off just means nurses stop recording it. It's logged with
 * who and why so it shows up in review instead.
 */
export async function recordExternalStock(input: {
  clinicId: number;
  nurseId: string;
  medName: string;
  quantity: number;
  source: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (input.quantity <= 0)
    return { ok: false, error: "Quantity must be more than zero." };

  const existing = await getDocs(
    query(
      collection(db, "inventory"),
      where("clinicId", "==", input.clinicId),
      where("medName", "==", input.medName),
    ),
  );
  if (existing.empty) {
    await addDoc(collection(db, "inventory"), {
      medName: input.medName,
      quantity: input.quantity,
      threshold: 0,
      clinicId: input.clinicId,
      category: "External",
      lastUpdated: new Date().toISOString(),
    });
  } else {
    await addInventoryStock(existing.docs[0].id, input.quantity);
  }

  // Recorded as a Confirmed delivery with no pharmacist, so external stock
  // appears in the same history as everything else rather than materialising
  // out of nowhere.
  await addDoc(collection(db, "stockDeliveries"), {
    clinicId: input.clinicId,
    items: [{ name: input.medName, quantity: input.quantity }],
    status: "Confirmed",
    sentByPharmacistId: null,
    externalSource: input.source,
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    confirmedByNurseId: input.nurseId,
    confirmedAt: new Date().toISOString(),
  });

  // External stock bypasses the pharmacy entirely, so the clinic admin is
  // told — that's the accountability trail, since nothing prevents misuse.
  notifyClinicAdmins({
    clinicId: input.clinicId,
    title: "Stock recorded from outside supplier",
    message: `${input.nurseId} recorded ${input.quantity} × ${input.medName} from ${input.source}.`,
    link: "/admin/audit",
  });

  return { ok: true };
}
// ---------------------------------------------------------------------------
// Inventory forecasting.
//
// Uses standard inventory-management method, not invented numbers:
//   - Average daily usage from real dispensing history
//   - Days of stock remaining = on hand / average daily usage
//   - Reorder point = (average daily usage x lead time) + safety stock
//   - Suggested order = enough to cover the review period, minus what's left
//
// Deliberately NOT included: outbreak or geographic demand prediction. That
// needs epidemiological data this system doesn't have, and inventing it would
// look convincing while being fiction.
// ---------------------------------------------------------------------------

export interface MedForecast {
  name: string;
  onHand: number;
  avgDailyUse: number;
  daysRemaining: number | null; // null = no usage history yet
  reorderPoint: number;
  suggestedOrder: number;
  status: "critical" | "reorder" | "healthy" | "unknown";
  history: { date: string; units: number }[];
}

const LEAD_TIME_DAYS = 3; // typical supplier turnaround
const SAFETY_DAYS = 4; // buffer against demand spikes
const COVER_DAYS = 30; // how long an order should last

/**
 * Real usage history per medication over `days`, from the distributions
 * collection. Returns oldest-first so it charts naturally.
 */
type UsageMap = Record<string, { date: string; units: number }[]>;

export function useMedicationUsage(days = 30): UsageMap {
  const [usage, setUsage] = useState<UsageMap>({});

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "distributions"), (snap) => {
      const dayKeys: string[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dayKeys.push(d.toISOString().slice(0, 10));
      }

      const byMed: Record<string, number[]> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const medName = data.medName as string;
        const idx = dayKeys.indexOf(data.date as string);
        if (idx === -1 || !medName) return;
        if (!byMed[medName]) byMed[medName] = new Array(days).fill(0);
        byMed[medName][idx] += toNumber(data.unitsGiven);
      });

      const out: Record<string, { date: string; units: number }[]> = {};
      for (const [med, counts] of Object.entries(byMed)) {
        out[med] = counts.map((units, i) => ({ date: dayKeys[i], units }));
      }
      setUsage(out);
    });
    return () => unsub();
  }, [days]);

  return usage;
}

export function buildForecasts(
  stock: StockItem[],
  usage: Record<string, { date: string; units: number }[]>,
): MedForecast[] {
  return stock
    .map((s) => {
      const history = usage[s.name] ?? [];
      const totalUsed = history.reduce((sum, d) => sum + d.units, 0);
      const daysOfData = history.length || 1;
      const avgDailyUse = totalUsed / daysOfData;

      // No usage recorded — can't forecast, and saying "0 days left" would
      // be wrong. Report it as unknown rather than guessing.
      if (avgDailyUse <= 0) {
        return {
          name: s.name,
          onHand: s.units,
          avgDailyUse: 0,
          daysRemaining: null,
          reorderPoint: 0,
          suggestedOrder: 0,
          status: "unknown" as const,
          history,
        };
      }

      const daysRemaining = s.units / avgDailyUse;
      const reorderPoint = Math.ceil(
        avgDailyUse * LEAD_TIME_DAYS + avgDailyUse * SAFETY_DAYS,
      );
      const targetLevel = Math.ceil(
        avgDailyUse * (COVER_DAYS + LEAD_TIME_DAYS),
      );
      const suggestedOrder = Math.max(0, targetLevel - s.units);

      const status =
        daysRemaining <= LEAD_TIME_DAYS
          ? ("critical" as const)
          : s.units <= reorderPoint
            ? ("reorder" as const)
            : ("healthy" as const);

      return {
        name: s.name,
        onHand: s.units,
        avgDailyUse: Math.round(avgDailyUse * 10) / 10,
        daysRemaining: Math.round(daysRemaining * 10) / 10,
        reorderPoint,
        suggestedOrder,
        status,
        history,
      };
    })
    .sort((a, b) => {
      const rank = { critical: 0, reorder: 1, healthy: 2, unknown: 3 };
      if (rank[a.status] !== rank[b.status])
        return rank[a.status] - rank[b.status];
      return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
    });
}
/**
 * Plain-English reading of the forecast numbers, for someone who doesn't
 * want to interpret charts. Every sentence is derived from the same real
 * data the table shows — nothing here is generated or guessed.
 */
export function summariseForecasts(
  forecasts: MedForecast[],
  clinicName?: string,
): { headline: string; points: string[] } {
  const known = forecasts.filter((f) => f.status !== "unknown");
  const critical = forecasts.filter((f) => f.status === "critical");
  const reorder = forecasts.filter((f) => f.status === "reorder");
  const where = clinicName ?? "this clinic";

  if (forecasts.length === 0) {
    return {
      headline: `No stock is currently recorded for ${where}.`,
      points: [],
    };
  }

  if (known.length === 0) {
    return {
      headline: `${forecasts.length} medications are stocked at ${where}, but none have been dispensed recently.`,
      points: [
        "Without dispensing history there's nothing to forecast from — these figures will fill in as medication is handed out.",
      ],
    };
  }

  const headline =
    critical.length > 0
      ? `${critical.length} medication${critical.length === 1 ? "" : "s"} at ${where} will run out before a new order could arrive.`
      : reorder.length > 0
        ? `Stock at ${where} is holding, but ${reorder.length} item${reorder.length === 1 ? "" : "s"} should be reordered soon.`
        : `Stock levels at ${where} are healthy across all ${known.length} tracked medications.`;

  const points: string[] = [];

  if (critical.length > 0) {
    const worst = critical[0];
    points.push(
      `${worst.name} is the most urgent — about ${worst.daysRemaining} days left at the current rate of ${worst.avgDailyUse} per day. Ordering ${worst.suggestedOrder} would cover the next month.`,
    );
    if (critical.length > 1) {
      points.push(
        `Also running out soon: ${critical
          .slice(1, 4)
          .map((f) => `${f.name} (${f.daysRemaining}d)`)
          .join(", ")}${critical.length > 4 ? ", and others" : ""}.`,
      );
    }
  }

  if (reorder.length > 0) {
    points.push(
      `${reorder.length} item${reorder.length === 1 ? " has" : "s have"} dropped to the reorder point: ${reorder
        .slice(0, 3)
        .map((f) => f.name)
        .join(
          ", ",
        )}${reorder.length > 3 ? ", and others" : ""}. Not urgent yet, but worth including in the next order.`,
    );
  }

  // Busiest medication by total consumption.
  const busiest = [...known].sort((a, b) => b.avgDailyUse - a.avgDailyUse)[0];
  if (busiest && busiest.avgDailyUse > 0) {
    points.push(
      `${busiest.name} moves fastest at roughly ${busiest.avgDailyUse} units a day — the one most worth keeping ahead of.`,
    );
  }

  // Is overall demand rising or falling? Compare the two halves of the window.
  const totals = new Map<string, number>();
  for (const f of known) {
    for (const d of f.history) {
      totals.set(d.date, (totals.get(d.date) ?? 0) + d.units);
    }
  }
  const series = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (series.length >= 8) {
    const half = Math.floor(series.length / 2);
    const older = series.slice(0, half).reduce((s, [, v]) => s + v, 0);
    const recent = series.slice(half).reduce((s, [, v]) => s + v, 0);
    if (older > 0) {
      const change = Math.round(((recent - older) / older) * 100);
      if (Math.abs(change) >= 15) {
        points.push(
          change > 0
            ? `Dispensing is up about ${change}% compared with the earlier part of the month — demand is rising, so current stock will last less long than these figures suggest.`
            : `Dispensing is down about ${Math.abs(change)}% on the earlier part of the month, so stock should stretch further than the day counts imply.`,
        );
      }
    }
  }

  const noData = forecasts.filter((f) => f.status === "unknown").length;
  if (noData > 0) {
    points.push(
      `${noData} medication${noData === 1 ? " has" : "s have"} no recent dispensing record, so ${noData === 1 ? "it isn't" : "they aren't"} included in these forecasts.`,
    );
  }

  return { headline, points };
}
