import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

// ---------------------------------------------------------------------------
// AUTH RACE FIX — same pattern as doctor-service.ts. On a hard reload our
// own getAuth() resolves instantly (route guard lets the page render) but
// Firebase Auth's auth.currentUser is still null until the SDK rehydrates
// the session from IndexedDB. We wait for the first real auth event before
// touching Firestore.
// ---------------------------------------------------------------------------
function waitForAuthReady(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// ---------------------------------------------------------------------------
// CurrentPatient — flattened identity + medical record, since the patient
// pages (dashboard, medical-record) read straight off `patient.*` rather
// than a separate record object.
// ---------------------------------------------------------------------------

export interface CurrentPatient {
  patientId: string; // e.g. "Pat-1"
  userId?: number;
  medicalRecordNo?: number;
  fullName: string;
  idNumber?: string;
  contactNum?: string;
  email?: string;
  emergencyContactName?: string;
  emergencyContactNo?: string;
  chronicCondition?: string;
  prescription?: string;
  bloodType?: string;
  allergies?: string;
  bp?: string;
  glucose?: string;
  lastVisit?: string;
}

/**
 * One-shot lookup (not a hook) — resolves the "patients" doc ID for a given
 * numeric userId. Used by login.tsx right after authentication, before any
 * component that would call useCurrentPatient() has mounted, so this can't
 * rely on the live subscription/cache below.
 *
 * ASSUMPTION: "patients" docs carry a `userId` field pointing back to the
 * `users` collection (same relationship doctor-service.ts relies on for
 * doctors). Returns null if no matching patient doc exists.
 */
export async function getPatientIdForUserId(userId: number): Promise<string | null> {
  const snap = await getDocs(query(collection(db, "patients"), where("userId", "==", userId)));
  if (snap.empty) return null;
  return snap.docs[0].id;
}

const patientIdCacheByUid = new Map<string, Promise<string>>();

async function resolvePatientIdForUid(uid: string): Promise<string> {
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists() ? profileSnap.data() : ({} as Record<string, any>);
  return profile.patientId ?? "Pat-1";
}

/**
 * Live-subscribes to the signed-in patient's identity + medical record,
 * joining `patients` -> `users` -> `medicalRecords` client-side (Firestore
 * can't join across collections). Updates automatically if a nurse/doctor
 * edits the record while this page is open.
 */
export function useCurrentPatient(): { patient: CurrentPatient | null; loading: boolean } {
  const [uid, setUid] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);

  const [patientBase, setPatientBase] = useState<Record<string, any> | null>(null);
  const [userData, setUserData] = useState<Record<string, any>>({});
  const [mrData, setMrData] = useState<Record<string, any>>({});

  const [patient, setPatient] = useState<CurrentPatient | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. Resolve which uid is signed in.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      if (!user) setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Resolve patientId for that uid (cached per-uid).
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setLoading(true);

    if (!patientIdCacheByUid.has(uid)) {
      patientIdCacheByUid.set(uid, resolvePatientIdForUid(uid));
    }
    patientIdCacheByUid
      .get(uid)!
      .then((pid) => {
        if (!cancelled) setPatientId(pid);
      })
      .catch((err) => {
        console.error("Failed to resolve current patient id:", err);
        patientIdCacheByUid.delete(uid);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // 3. Subscribe to the patient doc itself (waits for auth to be ready).
  useEffect(() => {
    if (!patientId) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    waitForAuthReady().then(() => {
      if (cancelled) return;
      unsubscribe = onSnapshot(doc(db, "patients", patientId), (snap) => {
        setPatientBase(snap.exists() ? snap.data() : null);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [patientId]);

  // 4. Subscribe to the linked user + medical record docs.
  useEffect(() => {
    if (patientBase?.userId == null) return;
    const unsubscribe = onSnapshot(doc(db, "users", String(patientBase.userId)), (snap) => {
      setUserData(snap.exists() ? snap.data() : {});
    });
    return () => unsubscribe();
  }, [patientBase?.userId]);

  useEffect(() => {
    if (patientBase?.medicalRecordNo == null) return;
    const unsubscribe = onSnapshot(
      doc(db, "medicalRecords", String(patientBase.medicalRecordNo)),
      (snap) => {
        setMrData(snap.exists() ? snap.data() : {});
      },
    );
    return () => unsubscribe();
  }, [patientBase?.medicalRecordNo]);

  // 5. Assemble the flattened CurrentPatient once the base doc has loaded.
  useEffect(() => {
    if (!patientId || !patientBase) return;
    const u = userData;
    const mr = mrData;

    setPatient({
      patientId,
      userId: patientBase.userId,
      medicalRecordNo: patientBase.medicalRecordNo,
      fullName: [u.names, u.surname].filter(Boolean).join(" ") || patientId,
      idNumber: u.idNumber,
      contactNum: u.contactNum,
      email: u.email,
      emergencyContactName: patientBase.emergencyContactName,
      emergencyContactNo: patientBase.emergencyContactNo,
      chronicCondition: patientBase.chronicCondition,
      prescription: mr.prescription,
      bloodType: mr.bloodType,
      allergies: mr.allergies,
      bp: mr.bp,
      glucose: mr.glucose != null ? String(mr.glucose) : undefined,
      lastVisit: mr.lastVisit,
    });
    setLoading(false);
  }, [patientId, patientBase, userData, mrData]);

  return { patient, loading };
}

// ---------------------------------------------------------------------------
// Appointments — plain array (not {appointments, loading}) to match how the
// route files consume it directly with .filter/.map/.length. `clinician` is
// left as the raw clinician ID (e.g. "Doc-1", "Nur-1") since that's what the
// appointments table displays, not a resolved name.
// ---------------------------------------------------------------------------

export interface PatientAppointmentRow {
  docId: string;
  dateTime: string; // full ISO, from appointDateTime
  type: string;
  clinicianId: string; // raw ID, e.g. "Doc-1", "Nur-1" — kept for reference/keys
  clinician: string; // resolved display name, e.g. "Dr. Mutizwa" or "Nurse Olorato" — falls back to clinicianId while resolving or if lookup fails
  status: string; // "Scheduled" | "Confirmed" | "Completed" | "Cancelled" | ...
}

function toDisplayStatus(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "Scheduled";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

// Clinician IDs come in two flavors — "Doc-1" (doctors collection) and
// "Nur-1" (nurses collection) — so the lookup checks the prefix and joins
// through to `users` for the real name, same join pattern doctor-service.ts
// uses for patient names. Cached across calls since clinician rosters don't
// change often within a session.
const clinicianNameCache = new Map<string, string>();

async function resolveClinicianName(clinicianId: string): Promise<string> {
  if (clinicianNameCache.has(clinicianId)) return clinicianNameCache.get(clinicianId)!;

  const isNurse = clinicianId.toLowerCase().startsWith("nur");
  const collectionName = isNurse ? "nurses" : "doctors";

  try {
    const snap = await getDoc(doc(db, collectionName, clinicianId));
    if (!snap.exists()) {
      clinicianNameCache.set(clinicianId, clinicianId);
      return clinicianId;
    }
    const c = snap.data();
    const uSnap = c.userId != null ? await getDoc(doc(db, "users", String(c.userId))) : null;
    const u = uSnap?.exists() ? uSnap.data() : {};
    const fullName = [u.names, u.surname].filter(Boolean).join(" ");
    const display = fullName
      ? isNurse
        ? `Nurse ${fullName}`
        : `Dr. ${fullName}`
      : clinicianId;
    clinicianNameCache.set(clinicianId, display);
    return display;
  } catch (err) {
    console.error(`Failed to resolve clinician name for ${clinicianId}:`, err);
    return clinicianId;
  }
}

export function usePatientAppointments(patientId: string | undefined): PatientAppointmentRow[] {
  const [appointments, setAppointments] = useState<PatientAppointmentRow[]>([]);

  useEffect(() => {
    if (!patientId) {
      setAppointments([]);
      return;
    }
    let cancelled = false;
    const q = query(collection(db, "appointments"), where("patientId", "==", patientId));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const base = snapshot.docs
        .map((d) => {
          const a = d.data();
          return {
            docId: d.id,
            dateTime: a.appointDateTime ?? "",
            type: a.appointType ?? "",
            clinicianId: a.clinician ?? "",
            status: toDisplayStatus(a.status ?? ""),
          };
        })
        .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

      // Show rows immediately with the raw ID, then swap in real names once
      // resolved — avoids blocking the whole list on name lookups.
      if (!cancelled) {
        setAppointments(base.map((a) => ({ ...a, clinician: a.clinicianId })));
      }

      const uniqueIds = [...new Set(base.map((a) => a.clinicianId))].filter(Boolean);
      await Promise.all(uniqueIds.map((id) => resolveClinicianName(id)));

      if (!cancelled) {
        setAppointments(
          base.map((a) => ({
            ...a,
            clinician: clinicianNameCache.get(a.clinicianId) ?? a.clinicianId,
          })),
        );
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [patientId]);

  return appointments;
}

/**
 * Writes a new status onto an appointment doc — used for the patient-facing
 * Confirm / Cancel buttons and the SMS confirm-link flow.
 */
export async function updateAppointmentStatus(
  docId: string,
  status: "Confirmed" | "Cancelled",
): Promise<void> {
  await updateDoc(doc(db, "appointments", docId), { status });
}

// ---------------------------------------------------------------------------
// Notifications — keyed by userId (not patientId), per the Alerts page.
// ASSUMPTION: top-level "notifications" collection with fields `userId`,
// `title`, `message`, `timeSent`, `isRead`. Adjust field names below if your
// schema differs.
// ---------------------------------------------------------------------------

export interface PatientNotification {
  docId: string;
  title: string;
  message: string;
  timeSent: string;
  isRead: boolean;
}

export function usePatientNotifications(userId: number | undefined): PatientNotification[] {
  const [items, setItems] = useState<PatientNotification[]>([]);

  useEffect(() => {
    if (userId == null) {
      setItems([]);
      return;
    }
    const q = query(collection(db, "notifications"), where("userId", "==", userId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows: PatientNotification[] = snapshot.docs
        .map((d) => {
          const n = d.data();
          return {
            docId: d.id,
            title: n.title ?? "",
            message: n.message ?? "",
            timeSent: n.timeSent ?? "",
            isRead: !!n.isRead,
          };
        })
        .sort((a, b) => b.timeSent.localeCompare(a.timeSent));
      setItems(rows);
    });
    return () => unsubscribe();
  }, [userId]);

  return items;
}

export async function markNotificationRead(docId: string): Promise<void> {
  await updateDoc(doc(db, "notifications", docId), { isRead: true });
}

export async function markAllNotificationsRead(docIds: string[]): Promise<void> {
  await Promise.all(docIds.map((id) => markNotificationRead(id)));
}

// ---------------------------------------------------------------------------
// Visit history — keyed by medicalRecordNo (per medical-record.tsx), unlike
// doctor-service.ts's medicalRecordsHistory lookup which keys off patientId.
// ASSUMPTION: history docs also carry a `medicalRecordNo` field alongside
// `patientId`. If they don't, swap the `where` clause below to filter by
// patientId instead and pass patient.patientId from the caller.
// ---------------------------------------------------------------------------

export interface VisitHistoryEntry {
  docId: string;
  description: string;
}

export function usePatientVisitHistory(
  medicalRecordNo: number | undefined,
): VisitHistoryEntry[] {
  const [visits, setVisits] = useState<VisitHistoryEntry[]>([]);

  useEffect(() => {
    if (medicalRecordNo == null) {
      setVisits([]);
      return;
    }
    const q = query(
      collection(db, "medicalRecordsHistory"),
      where("medicalRecordNo", "==", medicalRecordNo),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows: VisitHistoryEntry[] = snapshot.docs
        .map((d) => ({
          docId: d.id,
          description: d.data().description ?? "",
          historyId: Number(d.data().historyId ?? 0),
        }))
        .sort((a: any, b: any) => b.historyId - a.historyId)
        .map(({ docId, description }) => ({ docId, description }));
      setVisits(rows);
    });
    return () => unsubscribe();
  }, [medicalRecordNo]);

  return visits;
}