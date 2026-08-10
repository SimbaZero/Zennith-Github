// Live Firestore queries against the imported clinic dataset.
// Join path for a doctor's schedule:
//   profiles/{authUid}.legacyUserId → doctors.userId → doctors.doctorId
//   → appointments.clinician → patients/{patientId}.userId → users/{userId}
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth as getFbAuth,
  signInAnonymously,
} from "firebase/auth";
import { auth, db, firebaseConfig } from "@/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

// Same fix already proven in doctor-service.ts's waitForAuthReady(): on a
// hard page load, auth.currentUser can still be null for a brief moment
// while Firebase restores the session, even though the user really is
// signed in. Anything that reads auth.currentUser directly at that moment
// falls back to a wrong/empty default — this waits for the real answer
// before querying anything.
function waitForAuthReady(): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}
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

function toBadgeStatus(s: string): AppointmentStatus {
  const v = s.toLowerCase();
  if (v.startsWith("complet")) return "Complete";
  if (v.includes("progress")) return "In-progress";
  if (v.includes("no-show") || v.includes("no show") || v.includes("cancel"))
    return "No-show";
  // Was previously the unconditional fallback for EVERYTHING else,
  // including perfectly normal "Scheduled"/"Confirmed" appointments — they
  // displayed as "Incomplete" even though nothing was wrong. See #20 in
  // docs/db-issues.md.
  if (v.includes("confirm")) return "Confirmed";
  if (v.includes("schedul")) return "Scheduled";
  return "Incomplete";
}

async function patientNames(
  patientIds: string[],
): Promise<Map<string, { name: string; condition: string }>> {
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

// Resolves raw clinician IDs (e.g. "Doc-2", "Nur-1") to real display names,
// checking doctors then nurses. Same pattern as patientNames() above.
async function clinicianNames(
  clinicianIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(clinicianIds.filter(Boolean))];
  const out = new Map<string, string>();
  await Promise.all(
    unique.map(async (cid) => {
      const isNurse = cid.startsWith("Nur");
      const cSnap = await getDoc(doc(db, isNurse ? "nurses" : "doctors", cid));
      if (!cSnap.exists()) {
        out.set(cid, cid);
        return;
      }
      const c = cSnap.data();
      if (c.userId == null) {
        out.set(cid, cid);
        return;
      }
      const uSnap = await getDoc(doc(db, "users", String(c.userId)));
      const u = uSnap.exists() ? uSnap.data() : {};
      const full = [u.names, u.surname].filter(Boolean).join(" ").trim();
      out.set(cid, full ? (isNurse ? full : `Dr. ${full}`) : cid);
    }),
  );
  return out;
}

async function resolveClinicianId(): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  const profile = await getDoc(doc(db, "profiles", uid));
  const data = profile.exists() ? profile.data() : {};
  const isNurse = data.role === "nurse";
  const col = isNurse ? "nurses" : "doctors";
  const idField = isNurse ? "nurseId" : "doctorId";
  if (data.legacyUserId != null) {
    const snap = await getDocs(
      query(
        collection(db, col),
        where("userId", "==", Number(data.legacyUserId)),
      ),
    );
    if (!snap.empty) return snap.docs[0].data()[idField] ?? snap.docs[0].id;
  }
  return isNurse ? "Nur-1" : "Doc-1";
}

// ---------------------------------------------------------------------------
// ACUTE CARE TRIAGE SYSTEM — Sprint 1 Handoff Fixes
// ---------------------------------------------------------------------------

export type TriageLevel = "red" | "orange" | "yellow" | "green";

export type QueueStatus = "waiting" | "called" | "in-room" | "handoff" | "done";

export interface QueueEntry {
  id: string;
  patientId: string;
  patientName: string;
  reason: string;
  clinician: string | null;
  triage: TriageLevel;
  priority: "normal" | "urgent";
  status: QueueStatus;
  joinedAt: string;
  calledAt: string | null;
  facilityId: string | null;
  handedOffTo: string | null;
  handedOffAt: string | null;
  handedOffBy: string | null;
  inRoomAt: string | null;
  doneAt: string | null;
}

const TRIAGE_ORDER: Record<TriageLevel, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
  green: 3,
};

export const TRIAGE_LABELS: Record<TriageLevel, string> = {
  red: "Critical — Immediate",
  orange: "Emergent — 10 min",
  yellow: "Urgent — 30 min",
  green: "Less Urgent — 60 min",
};

export const TRIAGE_MAX_WAIT_MINUTES: Record<TriageLevel, number> = {
  red: 0,
  orange: 10,
  yellow: 30,
  green: 60,
};

const toQueueEntry = (id: string, x: DocumentData): QueueEntry => ({
  id,
  patientId: x.patientId ?? "",
  patientName: x.patientName ?? x.patientId ?? "",
  reason: x.reason ?? "",
  clinician: x.clinician ?? null,
  triage:
    typeof x.triage === "string" &&
    ["red", "orange", "yellow", "green"].includes(x.triage)
      ? (x.triage as TriageLevel)
      : "yellow",
  priority: x.priority === "urgent" ? "urgent" : "normal",
  status: (["waiting", "called", "in-room", "handoff", "done"].includes(
    x.status,
  )
    ? x.status
    : "waiting") as QueueStatus,
  joinedAt: x.joinedAt ?? "",
  calledAt: x.calledAt ?? null,
  facilityId: x.facilityId ?? null,
  handedOffTo: x.handedOffTo ?? null,
  handedOffAt: x.handedOffAt ?? null,
  handedOffBy: x.handedOffBy ?? null,
  inRoomAt: x.inRoomAt ?? null,
  doneAt: x.doneAt ?? null,
});

function sortQueue(rows: QueueEntry[]): QueueEntry[] {
  const rank = {
    waiting: 0,
    called: 1,
    "in-room": 2,
    handoff: 3,
    done: 4,
  } as Record<QueueStatus, number>;
  return [...rows].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      TRIAGE_ORDER[a.triage] - TRIAGE_ORDER[b.triage] ||
      a.joinedAt.localeCompare(b.joinedAt),
  );
}

export function subscribeQueue(
  onChange: (rows: QueueEntry[]) => void,
  onError?: (e: unknown) => void,
  facilityId?: string | null,
): () => void {
  // Previously always subscribed to the WHOLE queue collection with no
  // facility filter — every clinic saw every other clinic's walk-in queue,
  // even though each entry already stores facilityId. See #17 in
  // docs/db-issues.md.
  const q = facilityId
    ? query(collection(db, "queue"), where("facilityId", "==", facilityId))
    : collection(db, "queue");
  return onSnapshot(
    q,
    (snap) =>
      onChange(sortQueue(snap.docs.map((d) => toQueueEntry(d.id, d.data())))),
    (err) => onError?.(err),
  );
}

export async function fetchQueue(
  facilityId?: string | null,
): Promise<QueueEntry[]> {
  const q = facilityId
    ? query(collection(db, "queue"), where("facilityId", "==", facilityId))
    : collection(db, "queue");
  const snap = await getDocs(q);
  return sortQueue(snap.docs.map((d) => toQueueEntry(d.id, d.data())));
}

/** Get only acute care entries (not done) for a specific clinician or unassigned. */
export async function getAcuteQueue(
  clinicianFilter?: string,
): Promise<QueueEntry[]> {
  const all = await fetchQueue();
  const active = all.filter((q) => q.status !== "done");
  if (!clinicianFilter) return active;
  return active.filter(
    (q) =>
      q.clinician === clinicianFilter ||
      q.handedOffTo === clinicianFilter ||
      (!q.clinician && !q.handedOffTo),
  );
}

export async function addToQueue(input: {
  patientId: string;
  reason: string;
  clinician?: string;
  triage?: TriageLevel;
  priority?: "normal" | "urgent";
  facilityId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const pid = input.patientId.trim();
  const pSnap = await getDoc(doc(db, "patients", pid));
  if (!pSnap.exists())
    return { ok: false, error: `Patient "${pid}" not found` };

  const existing = await getDocs(
    query(collection(db, "queue"), where("patientId", "==", pid)),
  );
  if (existing.docs.some((d) => d.data().status !== "done")) {
    return { ok: false, error: `${pid} is already in the queue` };
  }

  const names = await patientNames([pid]);
  const entryRef = await addDoc(collection(db, "queue"), {
    patientId: pid,
    patientName: names.get(pid)?.name ?? pid,
    reason: input.reason.trim() || "Walk-in",
    clinician: input.clinician?.trim() || null,
    triage: input.triage ?? "yellow",
    priority: input.priority ?? "normal",
    status: "waiting",
    joinedAt: new Date().toISOString(),
    calledAt: null,
    facilityId: input.facilityId ?? null,
    handedOffTo: null,
    handedOffAt: null,
    handedOffBy: null,
    inRoomAt: null,
    doneAt: null,
  });

  // Audit log
  await logQueueEvent({
    entryId: entryRef.id,
    patientId: pid,
    action: "added",
    triage: input.triage ?? "yellow",
    by: auth.currentUser?.uid ?? "system",
    details: `Added to queue: ${input.reason || "Walk-in"}`,
    facilityId: input.facilityId ?? null,
  });

  return { ok: true };
}

export async function callPatient(
  entry: QueueEntry,
  deliverAt: Date,
): Promise<void> {
  await updateDoc(doc(db, "queue", entry.id), {
    status: "called",
    calledAt: new Date().toISOString(),
  });

  const pSnap = await getDoc(doc(db, "patients", entry.patientId));
  const userId = pSnap.exists() ? Number(pSnap.data().userId) : null;
  if (userId == null || Number.isNaN(userId)) return;

  await addDoc(collection(db, "notifications"), {
    notifId: Date.now(),
    userId,
    title: "You're being called",
    message: entry.clinician
      ? `Please proceed to ${entry.clinician}. ${entry.reason}`.trim()
      : `Please proceed to the consulting room. ${entry.reason}`.trim(),
    isRead: false,
    timeSent: deliverAt.toISOString(),
  });

  await logQueueEvent({
    entryId: entry.id,
    patientId: entry.patientId,
    action: "called",
    triage: entry.triage,
    by: auth.currentUser?.uid ?? "system",
    details: `Called by ${entry.clinician || "reception"}`,
    facilityId: entry.facilityId,
  });
}

export async function setQueueStatus(
  id: string,
  status: QueueStatus,
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === "called") updates.calledAt = new Date().toISOString();
  if (status === "in-room") updates.inRoomAt = new Date().toISOString();
  if (status === "done") updates.doneAt = new Date().toISOString();
  await updateDoc(doc(db, "queue", id), updates);

  const entrySnap = await getDoc(doc(db, "queue", id));
  if (entrySnap.exists()) {
    const entry = toQueueEntry(id, entrySnap.data());

    // The per-row "Call" button was silently NOT notifying the patient —
    // only "Call Next" (callPatient(), above) did. Same real notification
    // now fires from both paths.
    if (status === "called") {
      const pSnap = await getDoc(doc(db, "patients", entry.patientId));
      const userId = pSnap.exists() ? Number(pSnap.data().userId) : null;
      if (userId != null && !Number.isNaN(userId)) {
        await addDoc(collection(db, "notifications"), {
          notifId: Date.now(),
          userId,
          title: "You're being called",
          message: entry.clinician
            ? `Please proceed to ${entry.clinician}. ${entry.reason}`.trim()
            : `Please proceed to the consulting room. ${entry.reason}`.trim(),
          isRead: false,
          timeSent: new Date().toISOString(),
        });
      }
    }

    await logQueueEvent({
      entryId: id,
      patientId: entry.patientId,
      action: status,
      triage: entry.triage,
      by: auth.currentUser?.uid ?? "system",
      details: `Status changed to ${status}`,
      facilityId: entry.facilityId,
    });
  }
}

export async function handoffPatient(
  entryId: string,
  targetClinician: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entrySnap = await getDoc(doc(db, "queue", entryId));
    const entry = entrySnap.exists()
      ? toQueueEntry(entryId, entrySnap.data())
      : null;

    await updateDoc(doc(db, "queue", entryId), {
      status: "handoff",
      handedOffTo: targetClinician,
      handedOffAt: new Date().toISOString(),
      handedOffBy: auth.currentUser?.uid ?? "unknown",
    });

    await logQueueEvent({
      entryId,
      patientId: entry?.patientId ?? "unknown",
      action: "handoff",
      triage: entry?.triage ?? "yellow",
      by: auth.currentUser?.uid ?? "system",
      details: `Handed off from ${entry?.clinician ?? "reception"} to ${targetClinician}`,
      facilityId: entry?.facilityId ?? null,
    });

    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Handoff failed",
    };
  }
}

export async function acceptHandoff(
  entryId: string,
  newClinician: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const entrySnap = await getDoc(doc(db, "queue", entryId));
    const entry = entrySnap.exists()
      ? toQueueEntry(entryId, entrySnap.data())
      : null;

    await updateDoc(doc(db, "queue", entryId), {
      status: "in-room",
      clinician: newClinician,
      handedOffTo: null,
      inRoomAt: new Date().toISOString(),
    });

    await logQueueEvent({
      entryId,
      patientId: entry?.patientId ?? "unknown",
      action: "accept-handoff",
      triage: entry?.triage ?? "yellow",
      by: auth.currentUser?.uid ?? "system",
      details: `${newClinician} accepted handoff from ${entry?.handedOffBy ?? "unknown"}`,
      facilityId: entry?.facilityId ?? null,
    });

    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Accept handoff failed",
    };
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const entrySnap = await getDoc(doc(db, "queue", id));
  const entry = entrySnap.exists() ? toQueueEntry(id, entrySnap.data()) : null;

  await deleteDoc(doc(db, "queue", id));

  if (entry) {
    await logQueueEvent({
      entryId: id,
      patientId: entry.patientId,
      action: "removed",
      triage: entry.triage,
      by: auth.currentUser?.uid ?? "system",
      details: "Removed from queue",
      facilityId: entry.facilityId,
    });
  }
}

// ---------------------------------------------------------------------------
// AUDIT LOG — persistent Firestore trail for Sprint 1 panel review
// ---------------------------------------------------------------------------

export interface QueueAuditEvent {
  id?: string;
  entryId: string;
  patientId: string;
  action: string;
  triage: TriageLevel;
  by: string;
  details: string;
  timestamp: Timestamp;
  // Was previously never recorded, so the audit log had no way to be
  // scoped by clinic even after the queue itself was fixed — every
  // receptionist saw every clinic's history mixed together.
  facilityId?: string | null;
}

export async function logQueueEvent(
  event: Omit<QueueAuditEvent, "id" | "timestamp">,
): Promise<void> {
  await addDoc(collection(db, "queueAudit"), {
    ...event,
    timestamp: serverTimestamp(),
  });
}

/** Fetch audit trail for a specific queue entry, or all recent events at a
 *  given facility (or system-wide if facilityId is omitted entirely). */
export async function fetchQueueAudit(
  entryId?: string,
  limitCount = 50,
  facilityId?: string | null,
): Promise<QueueAuditEvent[]> {
  let q;
  if (entryId) {
    q = query(
      collection(db, "queueAudit"),
      where("entryId", "==", entryId),
      orderBy("timestamp", "desc"),
      limit(limitCount),
    );
  } else if (facilityId != null) {
    q = query(
      collection(db, "queueAudit"),
      where("facilityId", "==", facilityId),
      orderBy("timestamp", "desc"),
      limit(limitCount),
    );
  } else {
    q = query(
      collection(db, "queueAudit"),
      orderBy("timestamp", "desc"),
      limit(limitCount),
    );
  }
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) =>
      ({
        id: d.id,
        ...d.data(),
      }) as QueueAuditEvent,
  );
}

// ---------------------------------------------------------------------------
// Pharmacy: inventory + distributions
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string;
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
        units: Number(x.quantity ?? 0),
        threshold: Number(x.threshold ?? 0),
        lastUpdated: x.lastUpdated ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRecentDistributions(): Promise<
  DistributionRecord[]
> {
  const snap = await getDocs(
    query(
      collection(db, "distributions"),
      orderBy("createdAt", "desc"),
      limit(15),
    ),
  );
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

export async function receiveStock(
  itemId: string,
  units: number,
): Promise<void> {
  const ref = doc(db, "inventory", itemId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Medication not found");
    const current = Number(snap.data().quantity ?? 0);
    tx.update(ref, {
      quantity: current + units,
      lastUpdated: new Date().toISOString(),
    });
  });
}

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
    tx.update(ref, {
      quantity: current - total,
      lastUpdated: new Date().toISOString(),
    });
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
// ---------------------------------------------------------------------------

export interface PatientSummary {
  patientId: string;
  name: string;
  condition: string;
  lastVisit: string;
}

async function toPatientSummary(
  pid: string,
  p: Record<string, unknown>,
): Promise<PatientSummary> {
  const userId = p.userId as string | number | undefined;
  const medicalRecordNo = p.medicalRecordNo as string | number | undefined;
  const [uSnap, mrSnap] = await Promise.all([
    getDoc(doc(db, "users", String(userId))),
    medicalRecordNo != null
      ? getDoc(doc(db, "medicalRecords", String(medicalRecordNo)))
      : Promise.resolve(null),
  ]);
  const u = uSnap.exists() ? uSnap.data() : {};
  const mr = mrSnap?.exists() ? mrSnap.data() : {};
  return {
    patientId: pid,
    name: [u.names, u.surname].filter(Boolean).join(" ") || pid,
    condition: (p.chronicCondition as string) ?? "—",
    lastVisit: ((mr.lastVisit as string) ?? "").slice(0, 10) || "—",
  };
}

/** Was previously always the first 30 `patients` docs system-wide (ordered by
 *  userId, no clinic filter) — receptionists saw a mixed bag from every
 *  clinic, and anything past #30 was invisible with no way to reach it via
 *  search (the search box only filtered what had already loaded). See #17
 *  in docs/db-issues.md.
 *
 *  Now scoped to the receptionist's own clinic when clinicId is passed.
 *  Caveat: any `patients` doc written before clinicId existed on the schema
 *  (or via a flow that still doesn't set it) won't match and won't show up
 *  here — that's a data-backfill problem, not something this query can fix. */
export async function fetchPatientPage(
  clinicId?: number | null,
): Promise<PatientSummary[]> {
  const q =
    clinicId != null
      ? query(
          collection(db, "patients"),
          where("clinicId", "==", clinicId),
          limit(200),
        )
      : query(collection(db, "patients"), orderBy("userId"), limit(200));
  const snap = await getDocs(q);
  return Promise.all(snap.docs.map((d) => toPatientSummary(d.id, d.data())));
}

export async function findPatient(
  pid: string,
  clinicId?: number | null,
): Promise<PatientSummary | null> {
  const snap = await getDoc(doc(db, "patients", pid));
  if (!snap.exists()) return null;
  // Direct-ID lookup bypasses the clinic-scoped browse list (fetchPatientPage,
  // see #19 in docs/db-issues.md) — this closes that gap. A patient outside
  // this clinic is treated as not found, same as if they didn't exist.
  if (clinicId != null && Number(snap.data().clinicId) !== clinicId)
    return null;
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
    getDocs(
      query(
        collection(db, "medicalRecordsHistory"),
        where("patientId", "==", pid),
      ),
    ),
    getDocs(
      query(collection(db, "appointments"), where("patientId", "==", pid)),
    ),
  ]);
  const u = uSnap.exists() ? uSnap.data() : {};
  const mr = mrSnap?.exists() ? mrSnap.data() : {};

  const now = new Date().toISOString();
  const upcoming = apptSnap.docs
    .map((d) => d.data())
    .filter((a) => (a.appointDateTime ?? "") > now)
    .sort((a, b) =>
      (a.appointDateTime ?? "").localeCompare(b.appointDateTime ?? ""),
    )[0];

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
      .map((d) => ({
        id: d.id,
        description: d.data().description ?? "",
        historyId: Number(d.data().historyId ?? 0),
      }))
      .sort((a, b) => b.historyId - a.historyId)
      .map(({ id, description }) => ({ id, description })),
  };
}

// ---------------------------------------------------------------------------
// Digitised (OCR) patient files
// ---------------------------------------------------------------------------

export interface DigitisedRecord {
  patientId: string;
  fullName?: string;
  idNumber?: string;
  dob?: string;
  cell?: string;
  diagnosis?: string;
  medication?: string;
  notes?: string;
  rawText: string;
  confidence: number;
}

export async function saveDigitisedRecord(
  rec: DigitisedRecord,
): Promise<{ ok: boolean; error?: string }> {
  const pid = rec.patientId.trim();
  const pSnap = await getDoc(doc(db, "patients", pid));
  if (!pSnap.exists())
    return { ok: false, error: `Patient "${pid}" not found` };
  const patient = pSnap.data();
  const recordNo = patient.medicalRecordNo;
  if (recordNo == null)
    return { ok: false, error: `${pid} has no medical record number` };

  const writes: Promise<unknown>[] = [];

  writes.push(
    addDoc(collection(db, "medicalRecordsHistory"), {
      historyId: Date.now(),
      medicalRecordNo: Number(recordNo),
      patientId: pid,
      description:
        (rec.notes?.trim() ? `${rec.notes.trim()} ` : "") +
        `[Digitised from paper file, OCR confidence ${Math.round(rec.confidence)}%]`,
      source: "ocr",
      rawText: rec.rawText.slice(0, 4000),
      capturedAt: new Date().toISOString(),
    }),
  );

  const mr: Record<string, unknown> = {};
  if (rec.diagnosis?.trim()) mr.diagnosis = rec.diagnosis.trim();
  if (rec.medication?.trim()) mr.prescription = rec.medication.trim();
  if (Object.keys(mr).length > 0) {
    mr.lastVisit = new Date().toISOString();
    writes.push(
      setDoc(doc(db, "medicalRecords", String(recordNo)), mr, { merge: true }),
    );
  }

  const u: Record<string, unknown> = {};
  if (rec.idNumber?.trim()) u.idNumber = rec.idNumber.trim();
  if (rec.cell?.trim()) u.contactNum = rec.cell.trim();
  if (rec.dob?.trim()) u.dateOfBirth = rec.dob.trim();
  if (Object.keys(u).length > 0 && patient.userId != null) {
    writes.push(
      setDoc(doc(db, "users", String(patient.userId)), u, { merge: true }),
    );
  }

  await Promise.all(writes);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Doctor appointments
// ---------------------------------------------------------------------------

export type RawAppointment = Omit<
  ClinicAppointment,
  "patientName" | "condition"
>;

export interface DoctorAppointments {
  doctorId: string;
  appts: RawAppointment[];
  dates: string[];
  scheduleDate: string;
}

export async function fetchDoctorAppointments(): Promise<DoctorAppointments> {
  const doctorId = await resolveClinicianId();
  const apptSnap = await getDocs(
    query(collection(db, "appointments"), where("clinician", "==", doctorId)),
  );
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

export async function attachPatientNames(
  appts: RawAppointment[],
): Promise<ClinicAppointment[]> {
  const names = await patientNames(appts.map((a) => a.patientId));
  return appts.map((a) => ({
    ...a,
    patientName: names.get(a.patientId)?.name ?? a.patientId,
    condition: names.get(a.patientId)?.condition ?? "",
  }));
}

const FROM_BADGE: Record<AppointmentStatus, string> = {
  Complete: "Completed",
  "In-progress": "In Progress",
  Incomplete: "Scheduled",
  "No-show": "No-Show",
  Scheduled: "Scheduled",
  Confirmed: "Confirmed",
};

export async function setAppointmentStatus(
  apptDocId: string,
  status: AppointmentStatus,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "appointments", apptDocId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Appointment not found");
    tx.update(ref, { status: FROM_BADGE[status] });
  });
}

export async function createAppointment(input: {
  patientId: string;
  date: string;
  time: string;
  type: string;
  clinician?: string;
}): Promise<void> {
  const patient = await getDoc(doc(db, "patients", input.patientId));
  if (!patient.exists())
    throw new Error(`Patient "${input.patientId}" not found`);

  let clinician = input.clinician?.trim();
  if (clinician) {
    const col = /^doc/i.test(clinician) ? "doctors" : "nurses";
    const c = await getDoc(doc(db, col, clinician));
    if (!c.exists())
      throw new Error(
        `Clinician "${clinician}" not found (use e.g. Doc-2 or Nur-315)`,
      );
  } else {
    clinician = await resolveClinicianId();
  }

  const nextId = await runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "appointments");
    const snap = await tx.get(ref);
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
    // Was previously omitted — appointments had no clinic scoping at all,
    // so any "recent appointments" view showed every clinic's bookings
    // mixed together. Sourced from the patient's own real clinicId, not the
    // booking receptionist's, since that's the clinic this appointment
    // actually belongs to. See #19 in docs/db-issues.md.
    ...(patient.data()?.clinicId != null
      ? { clinicId: patient.data()?.clinicId }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Reception: clinic-wide appointments + patient registration
// ---------------------------------------------------------------------------

export interface ClinicWideAppointment extends ClinicAppointment {
  clinician: string;
}

// Was previously always the 25 most recent appointments across the ENTIRE
// database with no clinic filter at all, despite the UI label claiming
// "clinic-wide" — see #19 in docs/db-issues.md. Now scoped by clinicId when
// provided. Two real caveats to flag to the team:
//  1. Only appointments booked AFTER this fix carry a clinicId (sourced from
//     the patient's own record) — older appointments predate the field and
//     won't match, so they simply won't appear in the scoped view. Backfill
//     is a separate data task, not something this query can fix.
//  2. This combines a `where` filter with `orderBy` on a different field,
//     which Firestore requires a composite index for. If this throws an
//     index-required error in the console, follow the link Firestore prints
//     in that error to auto-create it — can't be done from code.
export async function fetchRecentAppointments(
  clinicId?: number | null,
): Promise<ClinicWideAppointment[]> {
  const q =
    clinicId != null
      ? query(
          collection(db, "appointments"),
          where("clinicId", "==", clinicId),
          orderBy("appointDateTime", "desc"),
          limit(25),
        )
      : query(
          collection(db, "appointments"),
          orderBy("appointDateTime", "desc"),
          limit(25),
        );
  const snap = await getDocs(q);
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
  const clinicianDisplay = await clinicianNames(raw.map((a) => a.clinician));
  return raw.map((a) => ({
    ...a,
    patientName: names.get(a.patientId)?.name ?? a.patientId,
    condition: names.get(a.patientId)?.condition ?? "",
    clinician: clinicianDisplay.get(a.clinician) ?? a.clinician,
  }));
}

/** Resolves the currently logged-in receptionist's real clinic (numeric
 *  clinicId + name) and display name, via:
 *  profiles/{authUid}.legacyUserId → receptionists.userId → receptionists.clinicId → clinics.clinicId
 *  Same join pattern as resolveClinicianId() above, applied to receptionists. */
export interface CurrentReceptionist {
  name: string;
  clinicId: number | null;
  clinicName: string | null;
}
export async function resolveCurrentReceptionist(): Promise<CurrentReceptionist> {
  const user = await waitForAuthReady();
  const uid = user?.uid;
  if (!uid) return { name: "Receptionist", clinicId: null, clinicName: null };
  const profileSnap = await getDoc(doc(db, "profiles", uid));
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const name = profile.fullName || "Receptionist";
  if (profile.legacyUserId == null)
    return { name, clinicId: null, clinicName: null };

  const recSnap = await getDocs(
    query(
      collection(db, "receptionists"),
      where("userId", "==", Number(profile.legacyUserId)),
    ),
  );
  if (recSnap.empty) return { name, clinicId: null, clinicName: null };
  const clinicId = Number(recSnap.docs[0].data().clinicId);

  const clinicSnap = await getDoc(doc(db, "clinics", String(clinicId)));
  const clinicName = clinicSnap.exists()
    ? (clinicSnap.data().clinicName ?? null)
    : null;

  return {
    name,
    clinicId: Number.isFinite(clinicId) ? clinicId : null,
    clinicName,
  };
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
  /** Real numeric clinic the receptionist is registering this patient at.
   *  Was previously always omitted, so walk-in-registered patients had no
   *  clinicId at all — see docs/db-issues.md #16. */
  clinicId?: number | null;
  /** users.DOB — was collected on the form but never sent, see #16. */
  dob?: string;
  /** users.Gender — was collected on the form but never sent, see #16. */
  gender?: string;
  remarks: string;
}

export async function registerPatient(
  input: RegistrationInput,
): Promise<string> {
  const ids = await runTransaction(db, async (tx) => {
    const ref = doc(db, "counters", "registration");
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

  // Age is derived from DOB (schema stores both — see #16 in db-issues.md).
  let age: number | null = null;
  if (input.dob) {
    const dobDate = new Date(input.dob);
    if (!Number.isNaN(dobDate.getTime())) {
      const today = new Date();
      age = today.getFullYear() - dobDate.getFullYear();
      const monthDiff = today.getMonth() - dobDate.getMonth();
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < dobDate.getDate())
      ) {
        age -= 1;
      }
    }
  }

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
      DOB: input.dob || null,
      Gender: input.gender || null,
      Age: age,
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
      // Was previously omitted entirely — see #16 in db-issues.md.
      ...(input.clinicId != null ? { clinicId: input.clinicId } : {}),
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
  clinicId: number;
}

// Real clinic list — reads the actual `clinics` collection, unlike the old
// hardcoded 3-entry list in lib/clinic.ts. Used on the signup form so new
// patients actually get a real clinicId instead of none at all.
export interface RealClinic {
  clinicId: number;
  clinicName: string;
  type?: string;
}
export async function fetchRealClinics(): Promise<RealClinic[]> {
  // Firestore rules require request.auth != null for ANY read, but this
  // runs on the signup page before any account/session exists — without
  // this, the read is silently denied and the dropdown shows nothing.
  // Anonymous Auth is enabled in the Firebase project for local testing.
  // Long-term fix: a public `allow read` rule scoped to just the `clinics`
  // collection in the Firebase Console (clinic names aren't sensitive).
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const snap = await getDocs(collection(db, "clinics"));
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        clinicId: Number(data.clinicId),
        clinicName: data.clinicName ?? `Clinic ${data.clinicId}`,
        type: data.type,
      };
    })
    .sort((a, b) => a.clinicName.localeCompare(b.clinicName));
}

export async function signUpPatient(
  input: PatientSignupInput,
): Promise<{ ok: boolean; patientId?: string; error?: string }> {
  const email = input.email.trim().toLowerCase();
  const secondary = initializeApp(
    firebaseConfig,
    `patient-signup-${Date.now()}`,
  );
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
        ? (snap.data() as {
            patientNo: number;
            userNo: number;
            recordNo: number;
          })
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
        clinicId: input.clinicId,
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

    return { ok: true, patientId };
  } catch (err: unknown) {
    // Firebase Auth errors always carry a .code string; narrow instead of any.
    const code =
      err instanceof Object && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    const message = err instanceof Error ? err.message : undefined;
    if (code === "auth/email-already-in-use")
      return { ok: false, error: "An account with this email already exists" };
    if (code === "auth/weak-password")
      return { ok: false, error: "Password must be at least 6 characters" };
    if (code === "auth/invalid-email")
      return { ok: false, error: "Enter a valid email address" };
    if (code === "auth/operation-not-allowed")
      return {
        ok: false,
        error: "Email/Password sign-in is not enabled in Firebase",
      };
    console.error("signUpPatient failed:", code, message);
    return {
      ok: false,
      error: `Could not create account (${code ?? message ?? "unknown"})`,
    };
  } finally {
    await deleteApp(secondary);
  }
}

// ---------------------------------------------------------------------------
// Doctor dashboard
// ---------------------------------------------------------------------------

export async function fetchDoctorDashboard(): Promise<DoctorDashboardData> {
  const { doctorId, appts, scheduleDate } = await fetchDoctorAppointments();

  const day = appts.filter((a) => a.date === scheduleDate);
  const schedule = await attachPatientNames(day);

  const weekStart = new Date(scheduleDate);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const week = appts.filter(
    (a) => a.date >= weekStartIso && a.date <= scheduleDate,
  );

  return {
    doctorId,
    scheduleDate,
    schedule,
    stats: {
      dayTotal: day.length,
      dayCompleted: day.filter((a) => a.status === "Complete").length,
      pendingReviews: appts.filter(
        (a) =>
          a.type.toLowerCase().includes("review") && a.status !== "Complete",
      ).length,
      weekPatients: new Set(week.map((a) => a.patientId)).size,
      upcoming: appts.filter((a) => a.date > scheduleDate).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Patient record editing (Receptionist "View" -> prefilled edit page)
// ---------------------------------------------------------------------------

export interface PatientUpdateInput {
  chronicCondition?: string;
  emergencyContactName?: string;
  emergencyContactNo?: string;
}

export interface UserUpdateInput {
  names?: string;
  surname?: string;
  idNumber?: string;
  contactNum?: string;
  city?: string;
  suburb?: string;
  email?: string;
  dob?: string;
  gender?: string;
  marital?: string;
  residential?: string;
  mailing?: string;
  occupation?: string;
  employer?: string;
  employerTel?: string;
  employerAddr?: string;
  finClass?: string;
  scheme?: string;
  schemeNo?: string;
  deps?: string;
  income?: string;
  assets?: string;
  payerName?: string;
  payerTel?: string;
  payerRel?: string;
  payerAddr?: string;
  remarks?: string;
}

export interface MedicalRecordUpdateInput {
  bloodType?: string;
  allergies?: string;
  prescription?: string;
  dosage?: number;
  bp?: string;
  glucose?: number;
  cd4?: number;
  viralLoad?: number;
  insurancePolicyNumber?: string;
}

// Firestore's updateDoc() rejects any field explicitly set to `undefined` —
// it throws instead of just skipping it — so any blank/unset form field
// (e.g. a patient with no dosage recorded yet) would crash the whole save.
// Strip undefined-valued keys before every write instead.
function stripUndefined<T extends object>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export async function updatePatient(
  patientId: string,
  input: PatientUpdateInput,
): Promise<void> {
  await updateDoc(doc(db, "patients", patientId), {
    ...stripUndefined(input),
    lastUpdated: new Date().toISOString(),
  });
}

export async function updateUser(
  userId: string | number,
  input: UserUpdateInput,
): Promise<void> {
  await updateDoc(doc(db, "users", String(userId)), {
    ...stripUndefined(input),
    lastUpdated: new Date().toISOString(),
  });
}

export async function updateMedicalRecord(
  recordNo: string | number,
  input: MedicalRecordUpdateInput,
): Promise<void> {
  await updateDoc(doc(db, "medicalRecords", String(recordNo)), {
    ...stripUndefined(input),
    lastUpdated: new Date().toISOString(),
  });
}
