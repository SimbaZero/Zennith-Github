import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for "who is the current patient".
// Every page asks THIS function, never hardcodes a patient ID directly.
//
// TODO(login): currently hardcoded to one real test patient (Pat-2) since
// real patient login isn't built yet. When it is, change ONLY this function
// to derive the real patientId from the logged-in user's profile — nothing
// else in the patient pages needs to change.
// ---------------------------------------------------------------------------
export function getCurrentPatientId(): string {
  return "Pat-2";
}

export interface CurrentPatient {
  patientId: string;
  fullName: string;
  userId?: number;
  medicalRecordNo?: number;
  chronicCondition?: string;
  emergencyContactName?: string;
  emergencyContactNo?: string;
  // From users collection:
  idNumber?: string;
  contactNum?: string;
  // From medicalRecords collection:
  bloodType?: string;
  allergies?: string;
  bp?: string;
  glucose?: number;
  lastVisit?: string;
  prescription?: string;
}

/**
 * Loads the current patient's real record — joined with `users` (for name,
 * ID number, contact) and `medicalRecords` (for clinical summary fields).
 * Note: the real schema has no age, gender, or patient "status" field —
 * see db-issues.md #8. Those are simply omitted rather than faked.
 */
export function useCurrentPatient(): {
  patient: CurrentPatient | null;
  loading: boolean;
} {
  const [patient, setPatient] = useState<CurrentPatient | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const patientId = getCurrentPatientId();
        const pSnap = await getDoc(doc(db, "patients", patientId));
        if (!pSnap.exists()) {
          if (!cancelled) setLoading(false);
          return;
        }
        const p = pSnap.data();

        let fullName = "Unknown patient";
        let idNumber: string | undefined;
        let contactNum: string | undefined;
        if (p.userId != null) {
          const uSnap = await getDoc(doc(db, "users", String(p.userId)));
          if (uSnap.exists()) {
            const u = uSnap.data();
            fullName = `${u.names ?? ""} ${u.surname ?? ""}`.trim();
            idNumber = u.idNumber;
            contactNum = u.contactNum;
          }
        }

        let bloodType, allergies, bp, glucose, lastVisit, prescription;
        if (p.medicalRecordNo != null) {
          const mrSnap = await getDoc(
            doc(db, "medicalRecords", String(p.medicalRecordNo)),
          );
          if (mrSnap.exists()) {
            const mr = mrSnap.data();
            bloodType = mr.bloodType;
            allergies = mr.allergies;
            bp = mr.bp;
            glucose = mr.glucose;
            lastVisit = mr.lastVisit;
            prescription = mr.prescription;
          }
        }

        if (!cancelled) {
          setPatient({
            patientId: p.patientId ?? patientId,
            fullName,
            userId: p.userId,
            medicalRecordNo: p.medicalRecordNo,
            chronicCondition: p.chronicCondition,
            emergencyContactName: p.emergencyContactName,
            emergencyContactNo: p.emergencyContactNo,
            idNumber,
            contactNum,
            bloodType,
            allergies,
            bp,
            glucose,
            lastVisit,
            prescription,
          });
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load current patient:", err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { patient, loading };
}

export interface VisitHistoryEntry {
  docId: string;
  historyId: number;
  description: string;
}

/**
 * Live-subscribes to this patient's real visit history.
 * Note: medicalRecordsHistory has no explicit date field — sorted by
 * historyId descending as the best available proxy for chronological order.
 */
export function usePatientVisitHistory(
  medicalRecordNo: number | undefined,
): VisitHistoryEntry[] {
  const [entries, setEntries] = useState<VisitHistoryEntry[]>([]);

  useEffect(() => {
    if (medicalRecordNo == null) return;
    const q = query(
      collection(db, "medicalRecordsHistory"),
      where("medicalRecordNo", "==", medicalRecordNo),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        docId: d.id,
        historyId: d.data().historyId,
        description: d.data().description,
      }));
      items.sort((a, b) => b.historyId - a.historyId);
      setEntries(items);
    });
    return () => unsubscribe();
  }, [medicalRecordNo]);

  return entries;
}

export interface PatientAppointment {
  docId: string;
  dateTime: string; // ISO string
  type: string;
  clinician: string; // doctor ID, e.g. "Doc-1" — TODO: join to doctors collection for a real name later
  status: string;
}

/**
 * Live-subscribes to this patient's real appointments.
 */
export function usePatientAppointments(
  patientId: string | undefined,
): PatientAppointment[] {
  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);

  useEffect(() => {
    if (!patientId) return;
    const q = query(
      collection(db, "appointments"),
      where("patientId", "==", patientId),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          docId: d.id,
          dateTime: data.appointDateTime,
          type: data.appointType,
          clinician: data.clinician,
          status: data.status,
        };
      });
      items.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
      setAppointments(items);
    });
    return () => unsubscribe();
  }, [patientId]);

  return appointments;
}

export interface PatientNotification {
  docId: string;
  title: string;
  message: string;
  timeSent: string;
  isRead: boolean;
}

/**
 * Live-subscribes to this patient's real notifications, newest first.
 */
export function usePatientNotifications(
  userId: number | undefined,
): PatientNotification[] {
  const [notifications, setNotifications] = useState<PatientNotification[]>([]);

  useEffect(() => {
    if (userId == null) return;
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          docId: d.id,
          title: data.title,
          message: data.message,
          timeSent: data.timeSent,
          isRead: data.isRead ?? false,
        };
      });
      items.sort((a, b) => b.timeSent.localeCompare(a.timeSent));
      setNotifications(items);
    });
    return () => unsubscribe();
  }, [userId]);

  return notifications;
}

/**
 * Real write: updates an appointment's status in Firestore (e.g. patient
 * confirming or cancelling). Replaces the old localStorage-only mock version.
 */
export async function updateAppointmentStatus(
  docId: string,
  status: string,
): Promise<void> {
  await updateDoc(doc(db, "appointments", docId), { status });
}

/**
 * Real write: marks a single notification as read.
 */
export async function markNotificationRead(docId: string): Promise<void> {
  await updateDoc(doc(db, "notifications", docId), { isRead: true });
}

/**
 * Real write: marks multiple notifications as read at once (e.g. "Mark all read").
 */
export async function markAllNotificationsRead(
  docIds: string[],
): Promise<void> {
  await Promise.all(docIds.map((id) => markNotificationRead(id)));
}
