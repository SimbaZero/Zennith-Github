import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { AppointmentStatus } from "@/components/AppShell";

// ---------------------------------------------------------------------------
// AUTH RACE FIX
//
// On a hard page reload, our own `getAuth()` (localStorage-based) resolves
// instantly, so the route guard in doctor.tsx lets the page render right
// away. But Firebase Auth's `auth.currentUser` is still null at that point —
// it only gets populated a moment later once the SDK restores the session
// from IndexedDB. Anything that reads `auth.currentUser` directly runs too
// early, fails or falls back to a default, and only "fixes itself" once
// something forces a refetch.
//
// waitForAuthReady() waits for Firebase's *first* auth state event before we
// touch Firestore, so we only ever query once we actually know who's signed
// in. No flash, no guessing, no retry-driven delay.
// ---------------------------------------------------------------------------
export function waitForAuthReady(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for "who is the current doctor".
//
// Cached PER uid (not a single global slot) — so switching accounts without
// a full page reload can never hand one doctor's identity to another.
// ---------------------------------------------------------------------------

export interface CurrentDoctor {
  doctorId: string; // e.g. "Doc-1"
  userId?: number;
  clinicId?: number;
  clinicName?: string;
  fullName: string;
  email?: string;
  contactNum?: string;
  specialisation?: string;
  licenseNo?: string;
}

const doctorCacheByUid = new Map<string, Promise<CurrentDoctor>>();

async function resolveCurrentDoctorForUid(uid: string): Promise<CurrentDoctor> {
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists()
    ? profileSnap.data()
    : ({} as Record<string, any>);

  // Previously fell back to hardcoded "Doc-1" here — a different real
  // doctor's identity and clinic, shown silently with no error. Same fix
  // already applied to Nurse: fail loudly instead of borrowing someone
  // else's identity.
  if (profile.legacyUserId == null) {
    throw new Error(
      "Your staff profile has no linked doctor record — contact whoever set up your account.",
    );
  }

  const docSnap = await getDocs(
    query(
      collection(db, "doctors"),
      where("userId", "==", Number(profile.legacyUserId)),
    ),
  );
  if (docSnap.empty) {
    throw new Error(
      "Your staff profile has no linked doctor record — contact whoever set up your account.",
    );
  }

  const docData = docSnap.docs[0].data();
  return buildCurrentDoctor(docData.doctorId, docData);
}

async function buildCurrentDoctor(
  doctorId: string,
  doctorData: Record<string, any>,
): Promise<CurrentDoctor> {
  let fullName = doctorId;
  let email: string | undefined;
  let contactNum: string | undefined;

  if (doctorData.userId != null) {
    const uSnap = await getDoc(doc(db, "users", String(doctorData.userId)));
    if (uSnap.exists()) {
      const u = uSnap.data();
      fullName = [u.names, u.surname].filter(Boolean).join(" ") || doctorId;
      email = u.email;
      contactNum = u.contactNum;
    }
  }

  let clinicName: string | undefined;
  if (doctorData.clinicId != null) {
    const cSnap = await getDoc(doc(db, "clinics", String(doctorData.clinicId)));
    if (cSnap.exists()) clinicName = cSnap.data().clinicName;
  }

  return {
    doctorId,
    userId: doctorData.userId,
    clinicId: doctorData.clinicId,
    clinicName,
    fullName,
    email,
    contactNum,
    specialisation: doctorData.specialisation,
    licenseNo: doctorData.licenseNo,
  };
}
/** Still available if you want to force a fresh lookup for some reason. */
export function clearDoctorCache(): void {
  doctorCacheByUid.clear();
}

export function useCurrentDoctor(): {
  doctor: CurrentDoctor | null;
  loading: boolean;
  error: string | null;
} {
  const [doctor, setDoctor] = useState<CurrentDoctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Subscribe directly to Firebase auth state, so if the signed-in user
    // changes (a different doctor logs in) this hook re-resolves for the
    // NEW uid — it never reuses another user's cached identity.
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        if (!cancelled) {
          setDoctor(null);
          setError("Not signed in");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      if (!doctorCacheByUid.has(user.uid)) {
        doctorCacheByUid.set(user.uid, resolveCurrentDoctorForUid(user.uid));
      }

      doctorCacheByUid
        .get(user.uid)!
        .then((d) => {
          if (!cancelled) {
            setDoctor(d);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to resolve current doctor:", err);
          doctorCacheByUid.delete(user.uid); // don't poison the cache with a failed attempt
          if (!cancelled) {
            setError(err.message ?? "Could not load doctor profile");
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { doctor, loading, error };
}

// ---------------------------------------------------------------------------
// Appointments — live subscription, patient names joined in.
// ---------------------------------------------------------------------------

export interface DoctorAppointment {
  docId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  dateTime: string; // full ISO
  type: string;
  rawStatus: string;
  status: AppointmentStatus;
  patientId: string;
  patientName: string;
  condition: string;
}

export function toBadgeStatus(s: string): AppointmentStatus {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("complet")) return "Complete";
  if (v.includes("progress")) return "In-progress";
  if (v.includes("no-show") || v.includes("no show") || v.includes("cancel"))
    return "No-show";
  return "Incomplete";
}

const patientNameCache = new Map<string, { name: string; condition: string }>();

export async function resolvePatientNames(
  patientIds: string[],
): Promise<Map<string, { name: string; condition: string }>> {
  const unique = [...new Set(patientIds)].filter(
    (id) => !patientNameCache.has(id),
  );
  await Promise.all(
    unique.map(async (pid) => {
      const pSnap = await getDoc(doc(db, "patients", pid));
      if (!pSnap.exists()) {
        patientNameCache.set(pid, { name: pid, condition: "" });
        return;
      }
      const p = pSnap.data();
      const uSnap =
        p.userId != null
          ? await getDoc(doc(db, "users", String(p.userId)))
          : null;
      const u = uSnap?.exists() ? uSnap.data() : {};
      patientNameCache.set(pid, {
        name: [u.names, u.surname].filter(Boolean).join(" ") || pid,
        condition: p.chronicCondition ?? "",
      });
    }),
  );
  return patientNameCache;
}

/**
 * Live-subscribes to every appointment for this doctor. Patient names are
 * joined in client-side (Firestore can't join across collections) and kept
 * up to date whenever the appointment list changes.
 */
export function useDoctorAppointments(doctorId: string | undefined): {
  appointments: DoctorAppointment[];
  loading: boolean;
} {
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const namesReady = useRef(false);

  useEffect(() => {
    if (!doctorId) return;
    setLoading(true);

    const q = query(
      collection(db, "appointments"),
      where("clinician", "==", doctorId),
    );
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const raw = snapshot.docs.map((d) => {
        const a = d.data();
        const dt = new Date(a.appointDateTime);
        return {
          docId: d.id,
          date: dt.toISOString().slice(0, 10),
          time: dt.toISOString().slice(11, 16),
          dateTime: a.appointDateTime as string,
          type: a.appointType ?? "",
          rawStatus: a.status ?? "",
          status: toBadgeStatus(a.status ?? ""),
          patientId: a.patientId ?? "",
        };
      });

      const names = await resolvePatientNames(raw.map((a) => a.patientId));
      const withNames: DoctorAppointment[] = raw
        .map((a) => ({
          ...a,
          patientName: names.get(a.patientId)?.name ?? a.patientId,
          condition: names.get(a.patientId)?.condition ?? "",
        }))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      namesReady.current = true;
      setAppointments(withNames);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [doctorId]);

  return { appointments, loading };
}

// ---------------------------------------------------------------------------
// Dashboard — combines identity + live appointments + derived stats.
// ---------------------------------------------------------------------------

export interface DoctorDashboardData {
  doctorId: string;
  scheduleDate: string;
  schedule: DoctorAppointment[];
  stats: {
    dayTotal: number;
    dayCompleted: number;
    pendingReviews: number;
    weekPatients: number;
    upcoming: number;
  };
}

export function useDoctorDashboard(): {
  data: DoctorDashboardData | null;
  loading: boolean;
  error: string | null;
} {
  const { doctor, loading: doctorLoading, error } = useCurrentDoctor();
  const { appointments, loading: apptsLoading } = useDoctorAppointments(
    doctor?.doctorId,
  );

  const loading = doctorLoading || (!!doctor && apptsLoading);

  if (!doctor || loading) {
    return { data: null, loading, error };
  }

  const today = new Date().toISOString().slice(0, 10);
  const dates = [...new Set(appointments.map((a) => a.date))].sort();
  const scheduleDate = dates.includes(today)
    ? today
    : (dates.filter((d) => d <= today).pop() ?? dates[0] ?? today);

  const day = appointments.filter((a) => a.date === scheduleDate);

  const weekStart = new Date(scheduleDate);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const week = appointments.filter(
    (a) => a.date >= weekStartIso && a.date <= scheduleDate,
  );

  const data: DoctorDashboardData = {
    doctorId: doctor.doctorId,
    scheduleDate,
    schedule: day,
    stats: {
      dayTotal: day.length,
      dayCompleted: day.filter((a) => a.status === "Complete").length,
      // Previously counted every review-type appointment ever, no time
      // bound — a review from months ago counted the same as one from
      // yesterday, which is why this felt arbitrary. Now scoped to the
      // last 30 days: genuinely overdue paperwork, not a lifetime tally.
      // This 30-day window is a judgment call, not a confirmed spec —
      // worth confirming with the team if a different window makes more
      // clinical sense.
      pendingReviews: appointments.filter((a) => {
        const daysAgo = (Date.now() - new Date(a.date).getTime()) / 86_400_000;
        return (
          a.type.toLowerCase().includes("review") &&
          a.status !== "Complete" &&
          daysAgo >= 0 &&
          daysAgo <= 30
        );
      }).length,
      weekPatients: new Set(week.map((a) => a.patientId)).size,
      upcoming: appointments.filter((a) => a.date > scheduleDate).length,
    },
  };

  return { data, loading: false, error };
}

// ---------------------------------------------------------------------------
// Weekly schedule — Monday to Sunday, but the rollover to the NEXT week
// happens early: on Sunday from 18:00 onward, instead of waiting for
// midnight. So on Sunday 27 July at 18:00, the "current week" flips from
// (21 Jul – 27 Jul) to (28 Jul – 3 Aug).
//
// A ticking clock (checked every minute) means a page left open across that
// 18:00 boundary rolls over on its own, without a manual refresh.
// ---------------------------------------------------------------------------

export function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export interface WeekBounds {
  start: string; // YYYY-MM-DD, Monday
  end: string; // YYYY-MM-DD, Sunday
  dates: string[]; // 7 dates, Monday -> Sunday
}

export function computeWeekBounds(now: Date): WeekBounds {
  const effective = new Date(now);

  // Sunday 18:00 cutover: treat "today" as if it were already the next day
  // once we're at/after 18:00 on a Sunday, so the week flips a few hours early.
  if (effective.getDay() === 0 && effective.getHours() >= 18) {
    effective.setDate(effective.getDate() + 1);
  }

  const dow = effective.getDay(); // 0 = Sun ... 6 = Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(effective);
  monday.setDate(effective.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  return { start: dates[0], end: dates[6], dates };
}

export function useDoctorWeekSchedule(): {
  weekStart: string;
  weekEnd: string;
  dates: string[];
  apptsByDate: Record<string, DoctorAppointment[]>;
  loading: boolean;
  error: string | null;
} {
  const { doctor, loading: doctorLoading, error } = useCurrentDoctor();
  const { appointments, loading: apptsLoading } = useDoctorAppointments(
    doctor?.doctorId,
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
    loading: doctorLoading || (!!doctor && apptsLoading),
    error,
  };
}

// ---------------------------------------------------------------------------
// Patient directory — for the doctor's "Patient Files" page. Kept separate
// from appointments/dashboard logic since it's a plain patient lookup, not
// doctor-schedule-specific, but lives here so we don't need a new file.
// ---------------------------------------------------------------------------

export interface PatientDirectoryEntry {
  patientId: string;
  name: string;
  condition: string;
  lastVisit: string;
}

// Name/last-visit rarely change, so cache lookups across snapshot updates
// and across search queries — avoids re-fetching users/medicalRecords for
// patients we've already resolved.
const patientDetailCache = new Map<
  string,
  { name: string; lastVisit: string }
>();

async function enrichPatient(
  patientId: string,
  p: Record<string, any>,
): Promise<PatientDirectoryEntry> {
  const cached = patientDetailCache.get(patientId);
  if (cached) {
    return {
      patientId,
      name: cached.name,
      condition: p.chronicCondition ?? "—",
      lastVisit: cached.lastVisit,
    };
  }

  const [uSnap, mrSnap] = await Promise.all([
    p.userId != null
      ? getDoc(doc(db, "users", String(p.userId)))
      : Promise.resolve(null),
    p.medicalRecordNo != null
      ? getDoc(doc(db, "medicalRecords", String(p.medicalRecordNo)))
      : Promise.resolve(null),
  ]);
  const u = uSnap?.exists() ? uSnap.data() : {};
  const mr = mrSnap?.exists() ? mrSnap.data() : {};

  const name = [u.names, u.surname].filter(Boolean).join(" ") || patientId;
  const lastVisit = (mr.lastVisit ?? "").slice(0, 10) || "—";
  patientDetailCache.set(patientId, { name, lastVisit });

  return { patientId, name, condition: p.chronicCondition ?? "—", lastVisit };
}

/**
 * Live-subscribes to the first `pageSize` patients (ordered by userId).
 * Updates automatically if a patient's condition or record changes — no
 * manual refetch/invalidate needed.
 */
export function usePatientDirectory(
  pageSize = 30,
  clinicId?: number,
): {
  patients: PatientDirectoryEntry[];
  loading: boolean;
  error: string | null;
} {
  const [patients, setPatients] = useState<PatientDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q =
      clinicId != null
        ? query(
            collection(db, "patients"),
            where("clinicId", "==", clinicId),
            orderBy("userId"),
            limit(pageSize),
          )
        : query(collection(db, "patients"), orderBy("userId"), limit(pageSize));
    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const rows = await Promise.all(
          snapshot.docs.map((d) => enrichPatient(d.id, d.data())),
        );
        setPatients(rows);
        setLoading(false);
        setError(null); // clear a stale error if an earlier attempt on this same listener had failed
      },
      (err) => {
        // Previously had no error handler at all — a failed query (missing
        // index, permission issue, etc.) just hung on "Loading..." forever
        // with nothing in the UI to show for it.
        console.error("Failed to load patient directory:", err);
        setError(err.message ?? "Could not load patients");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [pageSize, clinicId]);

  return { patients, loading, error };
}

/**
 * Live-subscribes to a single patient by exact ID (e.g. "Pat-828") — used
 * when a search matches a Pat-### ID outside the loaded page.
 */
export function useFindPatientById(
  patientId: string | null,
  clinicId?: number,
): { patient: PatientDirectoryEntry | null; loading: boolean } {
  const [patient, setPatient] = useState<PatientDirectoryEntry | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setPatient(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, "patients", patientId),
      async (snap) => {
        if (!snap.exists()) {
          setPatient(null);
          setLoading(false);
          return;
        }
        const data = snap.data();
        // Direct-ID lookup bypasses the clinic-scoped list query above — this
        // closes that gap. A patient outside this clinic is treated as not
        // found, same as if they didn't exist, instead of being fetchable by
        // anyone who guesses or types a Pat-### ID from another clinic.
        if (clinicId != null && Number(data.clinicId) !== clinicId) {
          setPatient(null);
          setLoading(false);
          return;
        }
        setPatient(await enrichPatient(snap.id, data));
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [patientId, clinicId]);

  return { patient, loading };
}
// ---------------------------------------------------------------------------
// Live patient record — used by the shared PatientRecordView (nurse + doctor).
//
// Same auth-race issue as the doctor dashboard: on a hard reload, Firebase
// Auth hasn't rehydrated yet, so an early Firestore read can fail or return
// incomplete data depending on your security rules. We reuse
// waitForAuthReady() (already defined above in this file) so we never touch
// Firestore before we actually know who's signed in.
//
// This also upgrades the record view from a one-time fetch to live
// subscriptions on the patient doc, medical record, and history — so if
// another user edits this patient's chart while it's open, it updates
// without a manual refresh.
// ---------------------------------------------------------------------------

import type { PatientRecord } from "@/lib/clinic-data";

export function usePatientRecord(pid: string | undefined): {
  record: PatientRecord | null;
  medicalRecordNo: number | null;
  loading: boolean;
  error: string | null;
} {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<number | null>(null);
  const [medicalRecordNo, setMedicalRecordNo] = useState<number | null>(null);

  const [patientBase, setPatientBase] = useState<Record<string, any> | null>(
    null,
  );
  const [userData, setUserData] = useState<Record<string, any>>({});
  const [mrData, setMrData] = useState<Record<string, any>>({});
  const [history, setHistory] = useState<
    { id: string; description: string; historyId: number }[]
  >([]);
  const [nextAppt, setNextAppt] = useState<Record<string, any> | undefined>(
    undefined,
  );

  // 1. Wait for auth, then subscribe to the patient doc itself.
  useEffect(() => {
    if (!pid) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    setLoading(true);
    setError(null);

    waitForAuthReady()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          setError("Not signed in");
          setLoading(false);
          return;
        }
        unsubscribe = onSnapshot(
          doc(db, "patients", pid),
          (snap) => {
            if (!snap.exists()) {
              setError(`Patient "${pid}" not found`);
              setPatientBase(null);
              setLoading(false);
              return;
            }
            const p = snap.data();
            setPatientBase(p);
            setUserId(p.userId ?? null);
            setMedicalRecordNo(p.medicalRecordNo ?? null);
          },
          (err) => {
            console.error("Failed to subscribe to patient record:", err);
            setError("Could not load medical record");
            setLoading(false);
          },
        );
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setError("Could not load medical record");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [pid]);

  // 2. Once we know userId / medicalRecordNo, subscribe to those docs too.
  useEffect(() => {
    if (userId == null) return;
    const unsubscribe = onSnapshot(doc(db, "users", String(userId)), (snap) => {
      setUserData(snap.exists() ? snap.data() : {});
    });
    return () => unsubscribe();
  }, [userId]);

  useEffect(() => {
    if (medicalRecordNo == null) return;
    const unsubscribe = onSnapshot(
      doc(db, "medicalRecords", String(medicalRecordNo)),
      (snap) => {
        setMrData(snap.exists() ? snap.data() : {});
      },
    );
    return () => unsubscribe();
  }, [medicalRecordNo]);

  useEffect(() => {
    if (!pid) return;
    const q = query(
      collection(db, "medicalRecordsHistory"),
      where("patientId", "==", pid),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({
          id: d.id,
          description: d.data().description ?? "",
          historyId: Number(d.data().historyId ?? 0),
        }))
        .sort((a, b) => b.historyId - a.historyId);
      setHistory(items);
    });
    return () => unsubscribe();
  }, [pid]);

  useEffect(() => {
    if (!pid) return;
    const q = query(
      collection(db, "appointments"),
      where("patientId", "==", pid),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const now = new Date().toISOString();
      const upcoming = snap.docs
        .map((d) => d.data())
        .filter((a) => (a.appointDateTime ?? "") > now)
        .sort((a, b) =>
          (a.appointDateTime ?? "").localeCompare(b.appointDateTime ?? ""),
        )[0];
      setNextAppt(upcoming);
    });
    return () => unsubscribe();
  }, [pid]);

  // 3. Assemble the final record once the patient base doc has loaded.
  useEffect(() => {
    if (!pid || !patientBase) return;
    const p = patientBase;
    const u = userData;
    const mr = mrData;

    setRecord({
      patientId: pid,
      name: [u.names, u.surname].filter(Boolean).join(" ") || pid,
      idNumber: u.idNumber ?? "—",
      cell: u.contactNum ?? "—",
      address: [u.suburb, u.city].filter(Boolean).join(", ") || "—",
      email: u.email ?? "—",
      condition: p.chronicCondition ?? "—",
      emergencyContactName: p.emergencyContactName ?? "—",
      emergencyContactNo: p.emergencyContactNo ?? "—",
      bloodType: mr.bloodType ?? "—",
      allergies: mr.allergies ?? "None recorded",
      prescription: mr.prescription ?? "—",
      dosage: mr.dosage != null ? String(mr.dosage) : "—",
      bp: mr.bp ?? "—",
      glucose: mr.glucose != null ? String(mr.glucose) : "—",
      cd4: mr.cd4 ?? "—",
      viralLoad: mr.viralLoad ?? "—",
      insurance: mr.insurancePolicyNumber ?? "None",
      lastVisit: (mr.lastVisit ?? "").slice(0, 10) || "—",
      nextAppointment: nextAppt
        ? `${(nextAppt.appointDateTime ?? "").slice(0, 10)} · ${nextAppt.appointType ?? ""}`
        : "None scheduled",
      history: history.map(({ id, description }) => ({ id, description })),
    });
    setLoading(false);
  }, [pid, patientBase, userData, mrData, history, nextAppt]);

  return { record, medicalRecordNo, loading, error };
}
