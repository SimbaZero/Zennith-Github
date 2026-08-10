import { useEffect, useState } from "react";
import { registerPatient } from "@/lib/clinic-data";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

import {
  useMinuteTick,
  computeWeekBounds,
  useDoctorAppointments, // role-agnostic despite the name — just filters
  // appointments by whatever clinician id you pass
  // it, so nurse-service.ts calls it directly rather
  // than writing a second copy of the same hook.
  // (toBadgeStatus/resolvePatientNames are used
  // internally by this hook — no need to import
  // them separately here.)
  usePatientDirectory, // patient lookups have nothing doctor-specific in
  useFindPatientById, // them — re-exported below so nurse pages have one
  usePatientRecord, // import source instead of reaching into doctor-service.ts
  type DoctorAppointment,
} from "@/lib/doctor-service";

export { usePatientDirectory, useFindPatientById, usePatientRecord };
export type { DoctorAppointment as NurseAppointment };

// ---------------------------------------------------------------------------
// Current nurse identity.
// ---------------------------------------------------------------------------

export interface CurrentNurse {
  nurseId: string; // e.g. "Nur-1"
  userId?: number;
  clinicId?: number;
  clinicName?: string;
  fullName: string;
  email?: string;
  contactNum?: string;
}

const nurseCacheByUid = new Map<string, Promise<CurrentNurse>>();

async function buildCurrentNurse(
  nurseId: string,
  nurseData: Record<string, any>,
): Promise<CurrentNurse> {
  let fullName = nurseId;
  let email: string | undefined;
  let contactNum: string | undefined;

  if (nurseData.userId != null) {
    const uSnap = await getDoc(doc(db, "users", String(nurseData.userId)));
    if (uSnap.exists()) {
      const u = uSnap.data();
      fullName = [u.names, u.surname].filter(Boolean).join(" ") || nurseId;
      email = u.email;
      contactNum = u.contactNum;
    }
  }

  let clinicName: string | undefined;
  if (nurseData.clinicId != null) {
    const cSnap = await getDoc(doc(db, "clinics", String(nurseData.clinicId)));
    if (cSnap.exists()) clinicName = cSnap.data().clinicName;
  }

  return {
    nurseId,
    userId: nurseData.userId,
    clinicId: nurseData.clinicId,
    clinicName,
    fullName,
    email,
    contactNum,
  };
}

async function resolveCurrentNurseForUid(uid: string): Promise<CurrentNurse> {
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists()
    ? profileSnap.data()
    : ({} as Record<string, any>);

  if (profile.role && profile.role !== "nurse") {
    throw new Error(`Signed-in user has role "${profile.role}", not "nurse"`);
  }

  // Previously fell back to hardcoded "Nur-1" in both cases below — meaning
  // a broken/incomplete profile silently showed a DIFFERENT real nurse's
  // name and clinic instead of a clear error. Fail loudly instead.
  if (profile.legacyUserId == null) {
    throw new Error(
      "Your staff profile has no linked nurse record — contact whoever set up your account.",
    );
  }

  const snap = await getDocs(
    query(
      collection(db, "nurses"),
      where("userId", "==", Number(profile.legacyUserId)),
    ),
  );
  if (snap.empty) {
    throw new Error(
      "Your staff profile has no linked nurse record — contact whoever set up your account.",
    );
  }

  const data = snap.docs[0].data();
  return buildCurrentNurse(data.nurseId, data);
}

export function useCurrentNurse(): {
  nurse: CurrentNurse | null;
  loading: boolean;
  error: string | null;
} {
  const [nurse, setNurse] = useState<CurrentNurse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (!user) {
        if (!cancelled) {
          setNurse(null);
          setError("Not signed in");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      if (!nurseCacheByUid.has(user.uid)) {
        nurseCacheByUid.set(user.uid, resolveCurrentNurseForUid(user.uid));
      }

      nurseCacheByUid
        .get(user.uid)!
        .then((n) => {
          if (!cancelled) {
            setNurse(n);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to resolve current nurse:", err);
          nurseCacheByUid.delete(user.uid);
          if (!cancelled) {
            setError(err.message ?? "Could not load nurse profile");
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { nurse, loading, error };
}

export function clearNurseCache(): void {
  nurseCacheByUid.clear();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface NurseDashboardData {
  nurseId: string;
  scheduleDate: string;
  schedule: DoctorAppointment[];
  stats: {
    dayTotal: number;
    dayCompleted: number;
    weekPatients: number;
    upcoming: number;
  };
}

export function useNurseDashboard(): {
  data: NurseDashboardData | null;
  loading: boolean;
  error: string | null;
} {
  const { nurse, loading: nurseLoading, error } = useCurrentNurse();
  const { appointments, loading: apptsLoading } = useDoctorAppointments(
    nurse?.nurseId,
  );

  const loading = nurseLoading || (!!nurse && apptsLoading);

  if (!nurse || loading) {
    return { data: null, loading, error };
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toISOString().slice(11, 16); // HH:mm, for same-day "later today"

  // Always show the real today, even if it's empty — no more silently
  // falling back to the last day that happened to have appointments.
  const scheduleDate = today;
  const day = appointments.filter((a) => a.date === scheduleDate);

  const weekStart = new Date(scheduleDate);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const week = appointments.filter(
    (a) => a.date >= weekStartIso && a.date <= scheduleDate,
  );

  const data: NurseDashboardData = {
    nurseId: nurse.nurseId,
    scheduleDate,
    schedule: day,
    stats: {
      dayTotal: day.length,
      dayCompleted: day.filter((a) => a.status === "Complete").length,
      weekPatients: new Set(week.map((a) => a.patientId)).size,
      // future days, OR later today
      upcoming: appointments.filter(
        (a) =>
          a.date > scheduleDate ||
          (a.date === scheduleDate && a.time > nowTime),
      ).length,
    },
  };

  return { data, loading: false, error };
}

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------

export function useNurseWeekSchedule(): {
  weekStart: string;
  weekEnd: string;
  dates: string[];
  apptsByDate: Record<string, DoctorAppointment[]>;
  loading: boolean;
  error: string | null;
} {
  const { nurse, loading: nurseLoading, error } = useCurrentNurse();
  const { appointments, loading: apptsLoading } = useDoctorAppointments(
    nurse?.nurseId,
  );
  const now = useMinuteTick();

  const { start, end, dates } = computeWeekBounds(now);

  const apptsByDate: Record<string, DoctorAppointment[]> = {};
  for (const d of dates) apptsByDate[d] = [];
  for (const a of appointments) {
    if (a.date >= start && a.date <= end) {
      apptsByDate[a.date] = apptsByDate[a.date] ?? [];
      apptsByDate[a.date].push(a);
    }
  }

  return {
    weekStart: start,
    weekEnd: end,
    dates,
    apptsByDate,
    loading: nurseLoading || (!!nurse && apptsLoading),
    error,
  };
}

// ---------------------------------------------------------------------------
// Shift handover log
//
// Consolidated here from clinic-data.ts, and CORRECTED against the real
// Firestore export: handoverEntries docs only ever have
// { nurseId, patientId, note, createdAt } — no shiftId/date/shiftType/
// finalized field on the entry itself. shifts docs only have
// { clinicId, date, finalized, finalizedAt, nurseId, shiftType } — no
// entryCount/summary. So an entry's Day/Night shift is NOT stored — it's
// classified at read time from the HOUR of createdAt, same as the old
// localStorage version's summarizeShift() did. "Finalizing" a shift does
// NOT touch existing entries (there's no field on them to mark) — it just
// writes a shifts doc recording that this nurse closed out this shift.
//
// Also note: createdAt/finalizedAt are real Firestore Timestamp objects in
// your data, not ISO strings — using serverTimestamp()/Timestamp here to
// match, unlike the ISO-string convention used elsewhere in clinic-data.ts.

export interface HandoverEntry {
  id: string;
  nurseId: string;
  patientId?: string;
  note: string;
  createdAt: Timestamp;
}

function isInShiftWindow(
  createdAt: Timestamp,
  shift: "Day" | "Night",
): boolean {
  const hour = createdAt.toDate().getHours();
  return shift === "Day" ? hour >= 7 && hour < 19 : hour >= 19 || hour < 7;
}

function isToday(createdAt: Timestamp): boolean {
  return createdAt.toDate().toISOString().slice(0, 10) === todayIso();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's entries for this nurse, classified into Day/Night by createdAt's
 * hour — not stored, computed here every time. */
export async function fetchHandoverEntries(
  nurseId: string,
  shift: "Day" | "Night",
): Promise<HandoverEntry[]> {
  const snap = await getDocs(
    query(collection(db, "handoverEntries"), where("nurseId", "==", nurseId)),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<HandoverEntry, "id">) }))
    .filter((e) => isToday(e.createdAt) && isInShiftWindow(e.createdAt, shift))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

export async function addHandoverEntry(input: {
  nurseId: string;
  patientId?: string;
  note: string;
}): Promise<void> {
  await addDoc(collection(db, "handoverEntries"), {
    nurseId: input.nurseId,
    patientId: input.patientId ?? null,
    note: input.note,
    createdAt: serverTimestamp(),
  });
}

export async function removeHandoverEntry(entryId: string): Promise<void> {
  await deleteDoc(doc(db, "handoverEntries", entryId));
}

/** Whether THIS nurse has already finalized today's given shift. */
export async function fetchShiftStatus(
  nurseId: string,
  shift: "Day" | "Night",
): Promise<{ finalized: boolean; finalizedAt?: Timestamp } | null> {
  const snap = await getDocs(
    query(
      collection(db, "shifts"),
      where("nurseId", "==", nurseId),
      where("date", "==", todayIso()),
      where("shiftType", "==", shift),
    ),
  );
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return { finalized: !!data.finalized, finalizedAt: data.finalizedAt };
}

/** Records that this nurse has closed out today's shift. Does not delete
 * or modify any handoverEntries — those remain as permanent history. */
export async function finalizeShift(input: {
  nurseId: string;
  clinicId: number;
  shift: "Day" | "Night";
}): Promise<void> {
  const existing = await fetchShiftStatus(input.nurseId, input.shift);
  if (existing?.finalized) return;

  await addDoc(collection(db, "shifts"), {
    clinicId: input.clinicId,
    nurseId: input.nurseId,
    date: todayIso(),
    shiftType: input.shift,
    finalized: true,
    finalizedAt: serverTimestamp(),
  });
}

/** count/patient-count from a list of entries. No fetch. */
export function summarizeShift(entries: HandoverEntry[]): {
  count: number;
  patients: number;
} {
  return {
    count: entries.length,
    patients: new Set(entries.map((e) => e.patientId).filter(Boolean)).size,
  };
}

// ---------------------------------------------------------------------------
// Adherence (chronic-care medication dose logging)
//

/** Today's dose status for a patient, keyed by medication name. */
export async function fetchAdherenceForToday(
  patientId: string,
): Promise<Record<string, boolean>> {
  const date = todayIso();
  const snap = await getDocs(
    query(
      collection(db, "patients", patientId, "adherenceLogs"),
      where("date", "==", date),
    ),
  );
  const out: Record<string, boolean> = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    out[x.med] = !!x.taken;
  });
  return out;
}

/** Marks (or unmarks) a medication as taken today for a patient. */
export async function setAdherence(
  patientId: string,
  med: string,
  taken: boolean,
  nurseId: string,
): Promise<void> {
  const date = todayIso();
  await setDoc(
    doc(db, "patients", patientId, "adherenceLogs", `${date}_${med}`),
    {
      med,
      date,
      taken,
      nurseId,
      updatedAt: serverTimestamp(),
    },
  );
}

// ---------------------------------------------------------------------------
// Digitize Files
//
// Writes into the EXISTING medicalRecords / medicalRecordsHistory tables —
// no separate "digitizations" audit collection. registerPatient is reused
// from clinic-data.ts for new patients, so patient-creation logic lives in
// exactly one place.

export interface DigitizedPatientData {
  fullName: string;
  idNumber: string;
  dateOfBirth: string; // YYYY-MM-DD — not currently written anywhere; see note below
  cellphone: string;
  diagnosis: string;
  currentMedication: string;
  notes: string;
}

export async function saveDigitizedFile(
  data: DigitizedPatientData,
  clinicId?: number,
): Promise<{ patientId: string; matchedExisting: boolean }> {
  let patientId: string;
  let matchedExisting = false;
  let medicalRecordNo: number | undefined;

  const uSnap = await getDocs(
    query(collection(db, "users"), where("idNumber", "==", data.idNumber)),
  );

  if (!uSnap.empty) {
    const userDocId = uSnap.docs[0].id;
    const pSnap = await getDocs(
      query(
        collection(db, "patients"),
        where("userId", "==", Number(userDocId)),
      ),
    );
    if (!pSnap.empty) {
      matchedExisting = true;
      patientId = pSnap.docs[0].id;
      const patientData = pSnap.docs[0].data();
      medicalRecordNo = patientData.medicalRecordNo;

      // Re-scan updates the existing user's contact info, per your
      // decision — role written with the same casing convention your real
      // data uses ("Patient", not "patient").
      await setDoc(
        doc(db, "users", userDocId),
        { contactNum: data.cellphone, role: "Patient" },
        { merge: true },
      );

      // diagnosis has nowhere else to live except patients.chronicCondition
      // (medicalRecords has no diagnosis field). dateOfBirth was previously
      // also written here onto `patients` — but that collection has no such
      // field in the real schema, it belongs on `users` (as `DOB`, same
      // field registerPatient() already writes for new patients below).
      await setDoc(
        doc(db, "patients", patientId),
        { chronicCondition: data.diagnosis || patientData.chronicCondition },
        { merge: true },
      );
      if (data.dateOfBirth && patientData.userId != null) {
        await setDoc(
          doc(db, "users", String(patientData.userId)),
          { DOB: data.dateOfBirth },
          { merge: true },
        );
      }
    }
  }

  if (!matchedExisting) {
    // registerPatient already writes contactNum (from data.cellphone,
    // passed in below) and role: "Patient" onto the new users doc — no
    // separate write needed for those two on this path.
    patientId = await registerPatient({
      fullName: data.fullName,
      nationalId: data.idNumber,
      contactNum: data.cellphone,
      city: "",
      suburb: "",
      emergencyContactName: "",
      emergencyContactNo: "",
      insurance: "",
      remarks: "",
      clinicId: clinicId ?? null,
    });

    const pSnap = await getDoc(doc(db, "patients", patientId!));
    const patientData = pSnap.data();
    medicalRecordNo = patientData?.medicalRecordNo;

    // registerPatient's own fields (chronicCondition, etc.) are already
    // set — this just adds DOB onto the real users doc it just created,
    // since registerPatient() doesn't currently accept DOB as a parameter
    // on this path. (Previously wrote dateOfBirth onto `patients` instead —
    // wrong collection, patients has no such field.)
    await setDoc(
      doc(db, "patients", patientId!),
      { chronicCondition: data.diagnosis || "Not yet assessed" },
      { merge: true },
    );
    if (data.dateOfBirth) {
      const newUserSnap = await getDoc(doc(db, "patients", patientId!));
      const newUserId = newUserSnap.data()?.userId;
      if (newUserId != null) {
        await setDoc(
          doc(db, "users", String(newUserId)),
          { DOB: data.dateOfBirth },
          { merge: true },
        );
      }
    }
  }

  // Everything digitize-specific goes into the patient's existing
  // medicalRecords doc, not a separate table.
  if (medicalRecordNo != null) {
    await setDoc(
      doc(db, "medicalRecords", String(medicalRecordNo)),
      {
        // Only include prescription when we actually have a value —
        // Firestore throws on `undefined` fields, it doesn't just skip them.
        ...(data.currentMedication
          ? { prescription: data.currentMedication }
          : {}),
        lastVisit: todayIso(),
      },
      { merge: true },
    );
    await addDoc(collection(db, "medicalRecordsHistory"), {
      historyId: Date.now(),
      medicalRecordNo,
      patientId: patientId!,
      description: `Digitized file: ${data.notes || data.diagnosis || "no notes"}`,
      visitDate: todayIso(),
    });
  }

  return { patientId: patientId!, matchedExisting };
}

// ---------------------------------------------------------------------------
// Dispense medication to a patient
//
// New collection — `distributions` already exists in the schema but is a
// DIFFERENT workflow (pharmacist -> clinic stock transfer, no patientId
// field at all). This is nurse -> patient, so it needed its own table:
// `patientDispensing`. Flagging that as a real schema addition, not
// something quietly repurposed from an existing collection.
// ---------------------------------------------------------------------------

export interface ClinicInventoryItem {
  docId: string;
  inventId: number;
  medName: string;
  quantity: number;
}

/** Only meds with real stock (>0) at this specific clinic — deliberately
 *  scoped, unlike the Pharmacist module's useInventory() which currently
 *  fetches the entire inventory collection with no clinic filter at all. */
export function useClinicInventory(clinicId: number | undefined): {
  items: ClinicInventoryItem[];
  loading: boolean;
} {
  const [items, setItems] = useState<ClinicInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (clinicId == null) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "inventory"),
      where("clinicId", "==", clinicId),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            docId: d.id,
            inventId: Number(data.inventId),
            medName: data.medName ?? "Unknown medication",
            quantity: Number(data.quantity) || 0,
          };
        })
        .filter((i) => i.quantity > 0);
      setItems(rows);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [clinicId]);

  return { items, loading };
}

export interface DispenseInput {
  patientId: string;
  clinicId: number;
  inventId: number;
  medName: string;
  unitsGiven: number;
  nurseId: string;
  note?: string;
  /** When provided, also stamps this patient's Last Visit as today —
   *  getting medication is a real visit, not just a Digitize scan. */
  medicalRecordNo?: number;
}

/** Decrements real inventory and logs the dispense event, atomically —
 *  wrapped in a transaction so two nurses dispensing the same medication
 *  at the same moment can't both succeed past the real stock level. */
export async function dispenseMedication(input: DispenseInput): Promise<void> {
  if (input.unitsGiven <= 0) throw new Error("Units must be greater than 0");

  const invSnap = await getDocs(
    query(collection(db, "inventory"), where("inventId", "==", input.inventId)),
  );
  if (invSnap.empty) throw new Error("Medication not found in inventory");
  const invDocRef = invSnap.docs[0].ref;

  // Look up the real userId so we can notify the actual patient — needed
  // for the notifications write below, not used anywhere else here.
  const patientSnap = await getDoc(doc(db, "patients", input.patientId));
  const patientUserId = patientSnap.exists()
    ? Number(patientSnap.data().userId)
    : null;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invDocRef);
    if (!snap.exists()) throw new Error("Medication not found in inventory");
    const current = Number(snap.data().quantity) || 0;
    if (current < input.unitsGiven) {
      throw new Error(
        `Not enough stock — only ${current} unit${current === 1 ? "" : "s"} left`,
      );
    }
    tx.update(invDocRef, {
      quantity: current - input.unitsGiven,
      lastUpdated: new Date().toISOString(),
    });
    tx.set(doc(collection(db, "patientDispensing")), {
      dispenseId: Date.now(), // TODO(db): placeholder — no real sequential counter for this collection yet, same convention as distributions.distributionId
      patientId: input.patientId,
      clinicId: input.clinicId,
      medName: input.medName,
      inventId: input.inventId,
      unitsGiven: input.unitsGiven,
      nurseId: input.nurseId,
      note: input.note || null,
      createdAt: serverTimestamp(),
    });
    if (input.medicalRecordNo != null) {
      tx.set(
        doc(db, "medicalRecords", String(input.medicalRecordNo)),
        { lastVisit: new Date().toISOString().slice(0, 10) },
        { merge: true },
      );
    }
    // Real notification for the patient — same collection/shape Receptionist's
    // callPatient() already writes to, not a new mechanism.
    if (patientUserId != null && !Number.isNaN(patientUserId)) {
      tx.set(doc(collection(db, "notifications")), {
        notifId: Date.now(),
        userId: patientUserId,
        title: "Medication dispensed",
        message: `You were given ${input.unitsGiven}× ${input.medName}.`,
        isRead: false,
        timeSent: new Date().toISOString(),
      });
    }
  });
}
