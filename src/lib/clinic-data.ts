// Live Firestore queries against the imported clinic dataset.
// Join path for a doctor's schedule:
//   profiles/{authUid}.legacyUserId → doctors.userId → doctors.doctorId
//   → appointments.clinician → patients/{patientId}.userId → users/{userId}
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth as getFbAuth } from "firebase/auth";
import { auth, db, firebaseConfig } from "@/firebase";
import type { AppointmentStatus } from "@/components/AppShell";

export interface ClinicAppointment {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  type: string;
  status: AppointmentStatus;
  rawStatus: string;
  patientId: string;
  patientName: string;
  condition: string;
}

export interface DoctorDashboardData {
  doctorId: string;
  /** Date the schedule list shows — today if the dataset has appointments today, otherwise the most recent day that does. */
  scheduleDate: string;
  schedule: ClinicAppointment[];
  stats: {
    dayTotal: number;
    dayCompleted: number;
    pendingReviews: number;
    weekPatients: number;
    upcoming: number;
  };
}

// The imported dataset uses statuses like "Completed"/"Scheduled"; the UI badge
// has its own vocabulary.
function toBadgeStatus(s: string): AppointmentStatus {
  const v = s.toLowerCase();
  if (v.startsWith("complet")) return "Complete";
  if (v.includes("progress")) return "In-progress";
  if (v.includes("no-show") || v.includes("no show") || v.includes("cancel")) return "No-show";
  return "Incomplete";
}

async function patientNames(patientIds: string[]): Promise<Map<string, { name: string; condition: string }>> {
  const unique = [...new Set(patientIds)];
  const out = new Map<string, { name: string; condition: string }>();
  await Promise.all(
    unique.map(async (pid) => {
      const pSnap = await getDoc(doc(db, "patients", pid));
      if (!pSnap.exists()) {
        out.set(pid, { name: pid, condition: "" });
        return;
      }
      const p = pSnap.data();
      const uSnap = await getDoc(doc(db, "users", String(p.userId)));
      const u = uSnap.exists() ? uSnap.data() : {};
      out.set(pid, {
        name: [u.names, u.surname].filter(Boolean).join(" ") || pid,
        condition: p.chronicCondition ?? "",
      });
    }),
  );
  return out;
}

/** Resolve the signed-in user's clinician id (Doc-N for doctors, Nur-N for
 *  nurses). Demo accounts (no legacyUserId in the dataset) fall back to
 *  Doc-1 / Nur-1 so the dashboards still demonstrate live data. */
async function resolveClinicianId(): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const profile = await getDoc(doc(db, "profiles", uid));
  const data = profile.exists() ? profile.data() : {};
  const isNurse = data.role === "nurse";
  const col = isNurse ? "nurses" : "doctors";
  const idField = isNurse ? "nurseId" : "doctorId";
  if (data.legacyUserId != null) {
    const snap = await getDocs(query(collection(db, col), where("userId", "==", Number(data.legacyUserId))));
    if (!snap.empty) return snap.docs[0].data()[idField] ?? snap.docs[0].id;
  }
  return isNurse ? "Nur-1" : "Doc-1";
}

// ---------------------------------------------------------------------------
// Pharmacy: inventory + distributions

export interface InventoryItem {
  id: string; // Firestore doc id
  inventId: number;
  name: string;
  category: string;
  units: number;
  threshold: number;
  lastUpdated: string;
}

export interface DistributionRecord {
  id: string;
  medName: string;
  nurseName: string;
  unitsGiven: number;
  date: string;
}

export async function fetchInventory(): Promise<InventoryItem[]> {
  const snap = await getDocs(collection(db, "inventory"));
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        inventId: Number(x.inventId ?? d.id),
        name: x.medName ?? "",
        category: x.category ?? "",
        // the imported dataset stores quantity as a string
        units: Number(x.quantity ?? 0),
        threshold: Number(x.threshold ?? 0),
        lastUpdated: x.lastUpdated ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRecentDistributions(): Promise<DistributionRecord[]> {
  const snap = await getDocs(query(collection(db, "distributions"), orderBy("createdAt", "desc"), limit(15)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      medName: x.medName ?? "",
      nurseName: x.nurseName ?? "",
      unitsGiven: Number(x.unitsGiven ?? 0),
      date: x.date ?? (x.createdAt ?? "").slice(0, 10),
    };
  });
}

/** Supplier intake: add units to an inventory item. */
export async function receiveStock(itemId: string, units: number): Promise<void> {
  const ref = doc(db, "inventory", itemId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Medication not found");
    const current = Number(snap.data().quantity ?? 0);
    tx.update(ref, { quantity: current + units, lastUpdated: new Date().toISOString() });
  });
}

/** Distribute units to nurses: deducts stock atomically, then logs one
 *  distributions record per nurse that received a non-zero amount. */
export async function distributeStock(
  itemId: string,
  allocations: Record<string, number>,
): Promise<void> {
  const total = Object.values(allocations).reduce((s, v) => s + v, 0);
  const ref = doc(db, "inventory", itemId);
  let medName = "";
  let inventId = 0;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Medication not found");
    const x = snap.data();
    const current = Number(x.quantity ?? 0);
    if (total > current) throw new Error("Total exceeds available stock");
    medName = x.medName ?? "";
    inventId = Number(x.inventId ?? 0);
    tx.update(ref, { quantity: current - total, lastUpdated: new Date().toISOString() });
  });
  const now = new Date();
  await Promise.all(
    Object.entries(allocations)
      .filter(([, units]) => units > 0)
      .map(([nurseName, unitsGiven]) =>
        addDoc(collection(db, "distributions"), {
          inventId,
          medName,
          nurseName,
          unitsGiven,
          date: now.toISOString().slice(0, 10),
          createdAt: now.toISOString(),
        }),
      ),
  );
}

// ---------------------------------------------------------------------------
// Patients + medical records

export interface PatientSummary {
  patientId: string;
  name: string;
  condition: string;
  lastVisit: string;
}

async function toPatientSummary(pid: string, p: Record<string, any>): Promise<PatientSummary> {
  const [uSnap, mrSnap] = await Promise.all([
    getDoc(doc(db, "users", String(p.userId))),
    p.medicalRecordNo != null
      ? getDoc(doc(db, "medicalRecords", String(p.medicalRecordNo)))
      : Promise.resolve(null),
  ]);
  const u = uSnap.exists() ? uSnap.data() : {};
  const mr = mrSnap?.exists() ? mrSnap.data() : {};
  return {
    patientId: pid,
    name: [u.names, u.surname].filter(Boolean).join(" ") || pid,
    condition: p.chronicCondition ?? "—",
    lastVisit: (mr.lastVisit ?? "").slice(0, 10) || "—",
  };
}

/** First page of patient files (the dataset holds thousands — search by ID for the rest). */
export async function fetchPatientPage(): Promise<PatientSummary[]> {
  const snap = await getDocs(query(collection(db, "patients"), orderBy("userId"), limit(30)));
  return Promise.all(snap.docs.map((d) => toPatientSummary(d.id, d.data())));
}

/** Direct lookup by patient ID, e.g. "Pat-828". */
export async function findPatient(pid: string): Promise<PatientSummary | null> {
  const snap = await getDoc(doc(db, "patients", pid));
  if (!snap.exists()) return null;
  return toPatientSummary(snap.id, snap.data());
}

export interface PatientRecord {
  patientId: string;
  name: string;
  idNumber: string;
  cell: string;
  address: string;
  email: string;
  condition: string;
  emergencyContactName: string;
  emergencyContactNo: string;
  bloodType: string;
  allergies: string;
  prescription: string;
  dosage: string;
  bp: string;
  glucose: string;
  cd4: string;
  viralLoad: string;
  insurance: string;
  lastVisit: string;
  nextAppointment: string;
  history: { id: string; description: string }[];
}

export async function fetchPatientRecord(pid: string): Promise<PatientRecord> {
  const pSnap = await getDoc(doc(db, "patients", pid));
  if (!pSnap.exists()) throw new Error(`Patient "${pid}" not found`);
  const p = pSnap.data();

  const [uSnap, mrSnap, histSnap, apptSnap] = await Promise.all([
    getDoc(doc(db, "users", String(p.userId))),
    p.medicalRecordNo != null
      ? getDoc(doc(db, "medicalRecords", String(p.medicalRecordNo)))
      : Promise.resolve(null),
    getDocs(query(collection(db, "medicalRecordsHistory"), where("patientId", "==", pid))),
    getDocs(query(collection(db, "appointments"), where("patientId", "==", pid))),
  ]);
  const u = uSnap.exists() ? uSnap.data() : {};
  const mr = mrSnap?.exists() ? mrSnap.data() : {};

  const now = new Date().toISOString();
  const upcoming = apptSnap.docs
    .map((d) => d.data())
    .filter((a) => (a.appointDateTime ?? "") > now)
    .sort((a, b) => (a.appointDateTime ?? "").localeCompare(b.appointDateTime ?? ""))[0];

  return {
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
    nextAppointment: upcoming
      ? `${(upcoming.appointDateTime ?? "").slice(0, 10)} · ${upcoming.appointType ?? ""}`
      : "None scheduled",
    history: histSnap.docs
      .map((d) => ({ id: d.id, description: d.data().description ?? "", historyId: Number(d.data().historyId ?? 0) }))
      .sort((a, b) => b.historyId - a.historyId)
      .map(({ id, description }) => ({ id, description })),
  };
}

// ---------------------------------------------------------------------------
// Doctor appointments

export type RawAppointment = Omit<ClinicAppointment, "patientName" | "condition">;

export interface DoctorAppointments {
  doctorId: string;
  appts: RawAppointment[];
  /** All distinct dates that have appointments, ascending. */
  dates: string[];
  /** Today if it has appointments, otherwise the most recent day that does. */
  scheduleDate: string;
}

export async function fetchDoctorAppointments(): Promise<DoctorAppointments> {
  const doctorId = await resolveClinicianId();
  const apptSnap = await getDocs(query(collection(db, "appointments"), where("clinician", "==", doctorId)));
  const appts = apptSnap.docs
    .map((d) => {
      const a = d.data();
      const dt = new Date(a.appointDateTime);
      return {
        id: d.id,
        date: dt.toISOString().slice(0, 10),
        time: dt.toISOString().slice(11, 16),
        type: a.appointType ?? "",
        rawStatus: a.status ?? "",
        status: toBadgeStatus(a.status ?? ""),
        patientId: a.patientId ?? "",
      };
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const today = new Date().toISOString().slice(0, 10);
  const dates = [...new Set(appts.map((a) => a.date))].sort();
  const scheduleDate = dates.includes(today)
    ? today
    : (dates.filter((d) => d <= today).pop() ?? dates[0] ?? today);

  return { doctorId, appts, dates, scheduleDate };
}

export async function attachPatientNames(appts: RawAppointment[]): Promise<ClinicAppointment[]> {
  const names = await patientNames(appts.map((a) => a.patientId));
  return appts.map((a) => ({
    ...a,
    patientName: names.get(a.patientId)?.name ?? a.patientId,
    condition: names.get(a.patientId)?.condition ?? "",
  }));
}

// UI badge status → dataset status vocabulary.
const FROM_BADGE: Record<AppointmentStatus, string> = {
  Complete: "Completed",
  "In-progress": "In Progress",
  Incomplete: "Scheduled",
  "No-show": "No-Show",
};

export async function setAppointmentStatus(apptDocId: string, status: AppointmentStatus): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "appointments", apptDocId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Appointment not found");
    tx.update(ref, { status: FROM_BADGE[status] });
  });
}

export async function createAppointment(input: {
  patientId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  type: string;
  /** Doc-N or Nur-N; defaults to the signed-in doctor. */
  clinician?: string;
}): Promise<void> {
  const patient = await getDoc(doc(db, "patients", input.patientId));
  if (!patient.exists()) throw new Error(`Patient "${input.patientId}" not found`);

  let clinician = input.clinician?.trim();
  if (clinician) {
    const col = /^doc/i.test(clinician) ? "doctors" : "nurses";
    const c = await getDoc(doc(db, col, clinician));
    if (!c.exists()) throw new Error(`Clinician "${clinician}" not found (use e.g. Doc-2 or Nur-315)`);
  } else {
    clinician = await resolveClinicianId();
  }

// Sequential doc IDs via a counters doc — so new appointments keep the
  // "1, 2, 3…" numbering instead of a random Firestore auto-ID.
  const nextId = await runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "appointments");
    const snap = await tx.get(ref);
    // Base of 10 matches your current max doc ID (1-10). Self-initializes
    // on first call — no manual Firestore edit needed.
    const cur = snap.exists() ? (snap.data() as { apptNo: number }).apptNo : 10;
    const next = cur + 1;
    tx.set(ref, { apptNo: next });
    return next;
  });

  await setDoc(doc(db, "appointments", String(nextId)), {
    appointmentId: nextId,
    appointDateTime: `${input.date}T${input.time}:00.000Z`,
    appointType: input.type,
    clinician,
    patientId: input.patientId,
    status: "Scheduled",
  });
}

// ---------------------------------------------------------------------------
// Reception: clinic-wide appointments + patient registration

export interface ClinicWideAppointment extends ClinicAppointment {
  clinician: string;
}

export async function fetchRecentAppointments(): Promise<ClinicWideAppointment[]> {
  const snap = await getDocs(
    query(collection(db, "appointments"), orderBy("appointDateTime", "desc"), limit(25)),
  );
  const raw = snap.docs.map((d) => {
    const a = d.data();
    const dt = new Date(a.appointDateTime);
    return {
      id: d.id,
      date: dt.toISOString().slice(0, 10),
      time: dt.toISOString().slice(11, 16),
      type: a.appointType ?? "",
      rawStatus: a.status ?? "",
      status: toBadgeStatus(a.status ?? ""),
      patientId: a.patientId ?? "",
      clinician: a.clinician ?? "",
    };
  });
  const names = await patientNames(raw.map((a) => a.patientId));
  return raw.map((a) => ({
    ...a,
    patientName: names.get(a.patientId)?.name ?? a.patientId,
    condition: names.get(a.patientId)?.condition ?? "",
  }));
}

export interface RegistrationInput {
  fullName: string;
  nationalId: string;
  contactNum: string;
  city: string;
  suburb: string;
  emergencyContactName: string;
  emergencyContactNo: string;
  insurance: string;
  remarks: string;
}

/**
 * Registers a new patient: allocates sequential IDs via a counters document
 * (race-safe), then creates the users, medicalRecords, and patients docs the
 * rest of the app joins across. Returns the new Pat-### id.
 */
export async function registerPatient(input: RegistrationInput): Promise<string> {
  const ids = await runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "registration");
    const snap = await tx.get(ref);
    // Bases sit far above the imported dataset's ranges to avoid collisions.
    const cur = snap.exists()
      ? (snap.data() as { patientNo: number; userNo: number; recordNo: number })
      : { patientNo: 9000, userNo: 90000, recordNo: 9000 };
    const next = { patientNo: cur.patientNo + 1, userNo: cur.userNo + 1, recordNo: cur.recordNo + 1 };
    tx.set(ref, next);
    return next;
  });

  const patientId = `Pat-${ids.patientNo}`;
  const [names, ...rest] = input.fullName.trim().split(/\s+/);
  const surname = rest.join(" ");

  await Promise.all([
    setDoc(doc(db, "users", String(ids.userNo)), {
      userId: ids.userNo,
      names,
      surname,
      role: "Patient",
      idNumber: input.nationalId,
      contactNum: input.contactNum,
      city: input.city,
      suburb: input.suburb,
      email: "",
    }),
    setDoc(doc(db, "medicalRecords", String(ids.recordNo)), {
      medicalRecordNo: ids.recordNo,
      insurancePolicyNumber: input.insurance || null,
      lastVisit: null,
      allergies: null,
      bloodType: null,
      prescription: null,
    }),
    setDoc(doc(db, "patients", patientId), {
      patientId,
      userId: ids.userNo,
      medicalRecordNo: ids.recordNo,
      chronicCondition: "Not yet assessed",
      emergencyContactName: input.emergencyContactName,
      emergencyContactNo: input.emergencyContactNo,
    }),
  ]);

  if (input.remarks.trim()) {
    await addDoc(collection(db, "medicalRecordsHistory"), {
      historyId: Date.now(),
      medicalRecordNo: ids.recordNo,
      patientId,
      description: `Registration note: ${input.remarks.trim()}`,
    });
  }
  return patientId;
}

export interface PatientSignupInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

/**
 * Public self-service signup (the "Create an account" flow on the login page).
 * Creates BOTH a Firebase Auth login and the linked clinical patient object:
 *   - users / medicalRecords / patients docs (same shape registerPatient writes)
 *   - a profiles/{uid} doc, role "patient", whose legacyUserId points at the new
 *     users row — the join every staff dashboard uses to find the patient.
 * IDs come from the same race-safe counters/registration document as the
 * receptionist flow. All writes run on a throwaway secondary app instance
 * (authenticated as the new patient) so any existing session is untouched.
 */
export async function signUpPatient(
  input: PatientSignupInput,
): Promise<{ ok: boolean; patientId?: string; error?: string }> {
  const email = input.email.trim().toLowerCase();
  const secondary = initializeApp(firebaseConfig, `patient-signup-${Date.now()}`);
  const fdb = getFirestore(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(
      getFbAuth(secondary),
      email,
      input.password,
    );

    const ids = await runTransaction(fdb, async (tx) => {
      const ref = doc(fdb, "counters", "registration");
      const snap = await tx.get(ref);
      const cur = snap.exists()
        ? (snap.data() as { patientNo: number; userNo: number; recordNo: number })
        : { patientNo: 9000, userNo: 90000, recordNo: 9000 };
      const next = {
        patientNo: cur.patientNo + 1,
        userNo: cur.userNo + 1,
        recordNo: cur.recordNo + 1,
      };
      tx.set(ref, next);
      return next;
    });

    const patientId = `Pat-${ids.patientNo}`;
    const [names, ...rest] = input.fullName.trim().split(/\s+/);
    const surname = rest.join(" ");

    await Promise.all([
      setDoc(doc(fdb, "users", String(ids.userNo)), {
        userId: ids.userNo,
        names,
        surname,
        role: "Patient",
        idNumber: "",
        contactNum: input.phone.trim(),
        city: "",
        suburb: "",
        email,
      }),
      setDoc(doc(fdb, "medicalRecords", String(ids.recordNo)), {
        medicalRecordNo: ids.recordNo,
        insurancePolicyNumber: null,
        lastVisit: null,
        allergies: null,
        bloodType: null,
        prescription: null,
      }),
      setDoc(doc(fdb, "patients", patientId), {
        patientId,
        userId: ids.userNo,
        medicalRecordNo: ids.recordNo,
        chronicCondition: "Not yet assessed",
        emergencyContactName: "",
        emergencyContactNo: "",
      }),
      setDoc(doc(fdb, "profiles", cred.user.uid), {
        username: email,
        role: "patient",
        fullName: input.fullName.trim(),
        email,
        legacyUserId: ids.userNo,
        builtin: false,
        createdAt: new Date().toISOString(),
      }),
    ]);

    // The confirmation email is sent separately via Resend (see
    // src/lib/welcome-email.ts) — Firebase's built-in email proved unreliable.
    return { ok: true, patientId };
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use")
      return { ok: false, error: "An account with this email already exists" };
    if (err.code === "auth/weak-password")
      return { ok: false, error: "Password must be at least 6 characters" };
    if (err.code === "auth/invalid-email")
      return { ok: false, error: "Enter a valid email address" };
    if (err.code === "auth/operation-not-allowed")
      return { ok: false, error: "Email/Password sign-in is not enabled in Firebase" };
    console.error("signUpPatient failed:", err.code, err.message);
    return { ok: false, error: `Could not create account (${err.code ?? err.message ?? "unknown"})` };
  } finally {
    await deleteApp(secondary);
  }
}

// ---------------------------------------------------------------------------
// Doctor dashboard

export async function fetchDoctorDashboard(): Promise<DoctorDashboardData> {
  const { doctorId, appts, scheduleDate } = await fetchDoctorAppointments();

  const day = appts.filter((a) => a.date === scheduleDate);
  const schedule = await attachPatientNames(day);

  const weekStart = new Date(scheduleDate);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const week = appts.filter((a) => a.date >= weekStartIso && a.date <= scheduleDate);

  return {
    doctorId,
    scheduleDate,
    schedule,
    stats: {
      dayTotal: day.length,
      dayCompleted: day.filter((a) => a.status === "Complete").length,
      pendingReviews: appts.filter((a) => a.type.toLowerCase().includes("review") && a.status !== "Complete").length,
      weekPatients: new Set(week.map((a) => a.patientId)).size,
      upcoming: appts.filter((a) => a.date > scheduleDate).length,
    },
  };
}
