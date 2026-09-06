import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
  updateDoc,
  where,
  type DocumentData,
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
  // From patients.clinicId, joined against the real clinics collection —
  // replaces the old fake localStorage "active clinic". undefined = this
  // patient has no clinicId set yet (e.g. very old self-registered accounts
  // from before signup started collecting one).
  clinicId?: number;
  clinicName?: string;
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
export async function getPatientIdForUserId(
  userId: number,
): Promise<string | null> {
  const snap = await getDocs(
    query(collection(db, "patients"), where("userId", "==", userId)),
  );
  if (snap.empty) return null;
  return snap.docs[0].id;
}

const patientIdCacheByUid = new Map<string, Promise<string>>();

async function resolvePatientIdForUid(uid: string): Promise<string> {
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists()
    ? profileSnap.data()
    : ({} as DocumentData);
  return profile.patientId ?? "Pat-1";
}

/**
 * Live-subscribes to the signed-in patient's identity + medical record,
 * joining `patients` -> `users` -> `medicalRecords` client-side (Firestore
 * can't join across collections). Updates automatically if a nurse/doctor
 * edits the record while this page is open.
 */
export function useCurrentPatient(): {
  patient: CurrentPatient | null;
  loading: boolean;
} {
  const [uid, setUid] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);

  const [patientBase, setPatientBase] = useState<DocumentData | null>(null);
  const [userData, setUserData] = useState<DocumentData>({});
  const [mrData, setMrData] = useState<DocumentData>({});
  const [clinicData, setClinicData] = useState<DocumentData>({});

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
      unsubscribe = onSnapshot(
        doc(db, "patients", patientId),
        (snap) => {
          setPatientBase(snap.exists() ? snap.data() : null);
        },
        (err) => {
          // Added so this listener can't fail silently.
          console.error("Firestore listener failed:", err);
        },
      );
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [patientId]);

  // 4. Subscribe to the linked user + medical record docs.
  useEffect(() => {
    if (patientBase?.userId == null) return;
    const unsubscribe = onSnapshot(
      doc(db, "users", String(patientBase.userId)),
      (snap) => {
        setUserData(snap.exists() ? snap.data() : {});
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
    return () => unsubscribe();
  }, [patientBase?.userId]);

  useEffect(() => {
    if (patientBase?.medicalRecordNo == null) return;
    const unsubscribe = onSnapshot(
      doc(db, "medicalRecords", String(patientBase.medicalRecordNo)),
      (snap) => {
        setMrData(snap.exists() ? snap.data() : {});
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
    return () => unsubscribe();
  }, [patientBase?.medicalRecordNo]);

  useEffect(() => {
    if (patientBase?.clinicId == null) return;
    const unsubscribe = onSnapshot(
      doc(db, "clinics", String(patientBase.clinicId)),
      (snap) => {
        setClinicData(snap.exists() ? snap.data() : {});
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
    return () => unsubscribe();
  }, [patientBase?.clinicId]);

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
      clinicId: patientBase.clinicId,
      clinicName: clinicData.clinicName,
    });
    setLoading(false);
  }, [patientId, patientBase, userData, mrData, clinicData]);

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
  if (clinicianNameCache.has(clinicianId))
    return clinicianNameCache.get(clinicianId)!;

  const isNurse = clinicianId.toLowerCase().startsWith("nur");
  const collectionName = isNurse ? "nurses" : "doctors";

  try {
    const snap = await getDoc(doc(db, collectionName, clinicianId));
    if (!snap.exists()) {
      clinicianNameCache.set(clinicianId, clinicianId);
      return clinicianId;
    }
    const c = snap.data();
    const uSnap =
      c.userId != null
        ? await getDoc(doc(db, "users", String(c.userId)))
        : null;
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

export function usePatientAppointments(
  patientId: string | undefined,
): PatientAppointmentRow[] {
  const [appointments, setAppointments] = useState<PatientAppointmentRow[]>([]);

  useEffect(() => {
    if (!patientId) {
      setAppointments([]);
      return;
    }
    let cancelled = false;
    const q = query(
      collection(db, "appointments"),
      where("patientId", "==", patientId),
    );
    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
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
          setAppointments(
            base.map((a) => ({ ...a, clinician: a.clinicianId })),
          );
        }

        const uniqueIds = [...new Set(base.map((a) => a.clinicianId))].filter(
          Boolean,
        );
        await Promise.all(uniqueIds.map((id) => resolveClinicianName(id)));

        if (!cancelled) {
          setAppointments(
            base.map((a) => ({
              ...a,
              clinician: clinicianNameCache.get(a.clinicianId) ?? a.clinicianId,
            })),
          );
        }
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
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

export function usePatientNotifications(
  userId: number | undefined,
): PatientNotification[] {
  const [items, setItems] = useState<PatientNotification[]>([]);

  useEffect(() => {
    if (userId == null) {
      setItems([]);
      return;
    }
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
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
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
    return () => unsubscribe();
  }, [userId]);

  return items;
}

export async function markNotificationRead(docId: string): Promise<void> {
  await updateDoc(doc(db, "notifications", docId), { isRead: true });
}

export async function markAllNotificationsRead(
  docIds: string[],
): Promise<void> {
  await Promise.all(docIds.map((id) => markNotificationRead(id)));
}

/**
 * Real write: sends the patient an immediate real notification nudging them
 * to confirm/cancel a specific upcoming appointment.
 *
 * TODO(infra): this only fires when the patient clicks "Remind me" — there is
 * no automatic "after N hours of no response" version yet. A truly automatic
 * reminder needs a server-side scheduled job (e.g. Firebase Cloud Functions
 * on a timer) checking unconfirmed appointments, which this stack doesn't
 * have (no custom server — the browser talks directly to Firebase).
 */
export async function requestAppointmentReminder(
  appt: { dateTime: string; type: string },
  userId: number,
): Promise<void> {
  const dt = new Date(appt.dateTime);
  const when = `${dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} at ${dt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
  await addDoc(collection(db, "notifications"), {
    notifId: Date.now(),
    userId,
    title: "Appointment needs confirmation",
    message: `You still haven't confirmed or cancelled your ${appt.type} appointment on ${when}.`,
    isRead: false,
    timeSent: new Date().toISOString(),
  });
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
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows: VisitHistoryEntry[] = snapshot.docs
          .map((d) => ({
            docId: d.id,
            description: d.data().description ?? "",
            historyId: Number(d.data().historyId ?? 0),
          }))
          .sort((a, b) => b.historyId - a.historyId)
          .map(({ docId, description }) => ({ docId, description }));
        setVisits(rows);
      },
      (err) => {
        // Added so this listener can't fail silently.
        console.error("Firestore listener failed:", err);
      },
    );
    return () => unsubscribe();
  }, [medicalRecordNo]);

  return visits;
}
// ---------------------------------------------------------------------------
// Privacy settings and data-deletion requests.
//
// Both were previously written to localStorage. That meant a patient's
// privacy preferences lived in one browser and vanished on cache clear, and —
// more seriously — a POPIA deletion request was saved to the patient's own
// device while the UI told them "admin will confirm within 48 hours". No
// admin ever saw it. The app was making a promise about a legal right that
// nothing behind it could keep.
// ---------------------------------------------------------------------------

export interface PrivacySettings {
  showIdNumber: boolean;
  showContact: boolean;
  showEmergencyContact: boolean;
  showAddress: boolean;
}

const PRIVACY_DEFAULTS: PrivacySettings = {
  showIdNumber: true,
  showContact: true,
  showEmergencyContact: true,
  showAddress: true,
};

/** Live privacy settings, stored on the patient's own record. */
export function usePrivacySettings(patientId?: string): {
  settings: PrivacySettings;
  loading: boolean;
} {
  const [settings, setSettings] = useState<PrivacySettings>(PRIVACY_DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "patients", patientId),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setSettings({ ...PRIVACY_DEFAULTS, ...(data.privacy ?? {}) });
        setLoading(false);
      },
      (err) => {
        console.error("Privacy settings read failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [patientId]);

  return { settings, loading };
}

export async function savePrivacySetting(
  patientId: string,
  key: keyof PrivacySettings,
  value: boolean,
): Promise<void> {
  await setDoc(
    doc(db, "patients", patientId),
    { privacy: { [key]: value } },
    { merge: true },
  );
}

/**
 * Records a real deletion request against the patient, so an admin can
 * actually see and act on it.
 *
 * NOTE: this raises a request — it does not delete anything. Under POPIA a
 * clinic must retain medical records for a defined period, so deletion is a
 * reviewed decision, not an automatic one. The UI must not imply otherwise.
 */
export async function requestDataDeletion(input: {
  patientId: string;
  clinicId?: number;
  reason?: string;
}): Promise<void> {
  await setDoc(
    doc(db, "patients", input.patientId),
    {
      deletionRequest: {
        status: "pending",
        requestedAt: new Date().toISOString(),
        ...(input.reason ? { reason: input.reason } : {}),
      },
    },
    { merge: true },
  );

  await addDoc(collection(db, "systemAudit"), {
    clinicId: input.clinicId ?? null,
    actor_id: input.patientId,
    action_type: "privacy.deletion_request",
    description: `${input.patientId} requested deactivation of their account and data`,
    timestamp: serverTimestamp(),
  });
}
// ---------------------------------------------------------------------------
// Medication collection status.
//
// The dashboard previously said "Available — ready for collection" to every
// patient, always, regardless of whether anything was actually waiting.
// Telling someone their medication is ready when it isn't sends them on a
// wasted trip to a clinic — which for a patient without transport money is a
// real cost, not a cosmetic bug.
//
// What the data can honestly support: whether they have a prescription on
// record, and when they last collected. It cannot tell us a parcel is
// packed and waiting — nothing in the system tracks that yet.
// ---------------------------------------------------------------------------

export type MedicationStatus =
  | { state: "none"; label: string; detail: string }
  | { state: "prescribed"; label: string; detail: string; medication: string }
  | { state: "collected"; label: string; detail: string; medication: string };

export function useMedicationStatus(
  patientId?: string,
  prescription?: string,
): { status: MedicationStatus; loading: boolean } {
  const [lastCollected, setLastCollected] = useState<{
    med: string;
    when: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, "patientDispensing"),
        where("patientId", "==", patientId),
      ),
      (snap) => {
        const rows = snap.docs
          .map((d) => d.data())
          .filter((r) => r.createdAt?.toDate)
          .sort(
            (a, b) =>
              b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime(),
          );
        const latest = rows[0];
        setLastCollected(
          latest
            ? {
                med: latest.medName ?? "medication",
                when: latest.createdAt.toDate().toISOString(),
              }
            : null,
        );
        setLoading(false);
      },
      (err) => {
        console.error("Dispensing history read failed:", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [patientId]);

  const med = prescription?.trim();

  if (!med) {
    return {
      status: {
        state: "none",
        label: "None on record",
        detail: "No medication is currently prescribed for you.",
      },
      loading,
    };
  }

  if (lastCollected) {
    const days = Math.floor(
      (Date.now() - new Date(lastCollected.when).getTime()) / 86_400_000,
    );
    return {
      status: {
        state: "collected",
        label: "Last collected",
        detail:
          days === 0
            ? `You collected ${lastCollected.med} today.`
            : days === 1
              ? `You collected ${lastCollected.med} yesterday.`
              : `You collected ${lastCollected.med} ${days} days ago.`,
        medication: med,
      },
      loading,
    };
  }

  return {
    status: {
      state: "prescribed",
      label: "Prescribed",
      detail: "Check with your clinic before travelling to collect.",
      medication: med,
    },
    loading,
  };
}
