import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/firebase";
import { logAction } from "@/lib/audit";
import { assertOnline } from "@/lib/offline";
import { notifyAllAdmins } from "@/lib/notify";
import {
  getStaffClinicIds,
  setStaffClinics,
  type MultiClinicRole,
} from "@/lib/clinic-data";

// Assigning a doctor or pharmacist to a new clinic is a request an admin
// approves, not something that takes effect the moment it is clicked.
//
//   request  -> a `clinicAssignmentRequests` document (status "pending"), one per
//               clinic asked for, and a notification to everyone with admin access
//   approve  -> the clinic is added to the person's clinicIds (setStaffClinics),
//               then the request is marked approved
//   deny     -> the request is closed; nothing about the person changes
//
// There is one global admin role rather than per-clinic admins, so any admin can
// decide any request. The request records who asked, when, and which clinics the
// person already works at, so whoever decides can see what they are agreeing to.

const COLLECTION = "clinicAssignmentRequests";

export type RequestStatus = "pending" | "approved" | "denied";

export interface ClinicAssignmentRequest {
  id: string;
  role: MultiClinicRole;
  staffId: string;
  staffName: string;
  /** The clinic they are being added to. */
  clinicId: number;
  clinicName: string;
  /** The clinics they work at now, when the request was made (home first). */
  currentClinicIds: number[];
  currentClinicNames: string[];
  requestedBy: string;
  requestedAt: string;
  status: RequestStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  denyReason?: string;
}

/** "Dr. Mokoena" for a doctor; a pharmacist's name is left as it is. */
export function staffTitle(role: MultiClinicRole, name: string): string {
  const clean = name.trim() || (role === "doctor" ? "doctor" : "pharmacist");
  return role === "doctor" && !/^dr\.?\s/i.test(clean) ? `Dr. ${clean}` : clean;
}

/** The sentence the admins are shown. */
export function requestSentence(r: {
  role: MultiClinicRole;
  staffName: string;
  clinicName: string;
}): string {
  return `Request to add ${staffTitle(r.role, r.staffName)} to ${r.clinicName} is pending approval`;
}

function fromDoc(
  id: string,
  x: Record<string, unknown>,
): ClinicAssignmentRequest {
  const nums = (v: unknown) =>
    Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.map((s) => String(s)) : [];
  return {
    id,
    role: x.role === "pharmacist" ? "pharmacist" : "doctor",
    staffId: String(x.staffId ?? ""),
    staffName: String(x.staffName ?? ""),
    clinicId: Number(x.clinicId),
    clinicName: String(x.clinicName ?? `Clinic ${x.clinicId}`),
    currentClinicIds: nums(x.currentClinicIds),
    currentClinicNames: strs(x.currentClinicNames),
    requestedBy: String(x.requestedBy ?? ""),
    requestedAt: String(x.requestedAt ?? ""),
    status: (["approved", "denied"].includes(String(x.status))
      ? x.status
      : "pending") as RequestStatus,
    resolvedBy: typeof x.resolvedBy === "string" ? x.resolvedBy : undefined,
    resolvedAt: typeof x.resolvedAt === "string" ? x.resolvedAt : undefined,
    denyReason: typeof x.denyReason === "string" ? x.denyReason : undefined,
  };
}

async function clinicNameOf(id: number): Promise<string> {
  const snap = await getDoc(doc(db, "clinics", String(id)));
  return snap.exists() && snap.data().clinicName
    ? String(snap.data().clinicName)
    : `Clinic ${id}`;
}

/** Whether a failure is the rules refusing the write (the collection isn't enabled yet). */
function isPermissionDenied(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "permission-denied";
}

/**
 * Asks for a person to be added to each of `clinicIds`. Creates one pending
 * request per clinic that isn't already theirs and doesn't already have a
 * pending request, and tells every admin. Returns how many were created.
 */
export async function requestClinicAssignments(input: {
  role: MultiClinicRole;
  staffId: string;
  staffName: string;
  clinicIds: number[];
  requestedBy: string;
}): Promise<{ created: number; alreadyPending: number; alreadyThere: number }> {
  assertOnline();
  const current = await getStaffClinicIds(input.role, input.staffId);
  const existing = await getDocs(
    query(collection(db, COLLECTION), where("staffId", "==", input.staffId)),
  );
  const pendingFor = new Set(
    existing.docs
      .filter((d) => d.data().status === "pending")
      .map((d) => Number(d.data().clinicId)),
  );

  const wanted = [...new Set(input.clinicIds.map(Number))].filter((n) =>
    Number.isInteger(n),
  );
  const alreadyThere = wanted.filter((c) => current.includes(c));
  const alreadyPending = wanted.filter(
    (c) => !current.includes(c) && pendingFor.has(c),
  );
  const toCreate = wanted.filter(
    (c) => !current.includes(c) && !pendingFor.has(c),
  );

  const currentNames = await Promise.all(current.map(clinicNameOf));
  let created = 0;
  for (const clinicId of toCreate) {
    const clinicName = await clinicNameOf(clinicId);
    try {
      await addDoc(collection(db, COLLECTION), {
        role: input.role,
        staffId: input.staffId,
        staffName: input.staffName,
        clinicId,
        clinicName,
        currentClinicIds: current,
        currentClinicNames: currentNames,
        requestedBy: input.requestedBy,
        requestedByUid: auth.currentUser?.uid ?? null,
        requestedAt: new Date().toISOString(),
        status: "pending" satisfies RequestStatus,
      });
    } catch (error) {
      if (isPermissionDenied(error)) {
        throw new Error(
          "Clinic assignment requests aren't switched on yet (the database permissions for them haven't been added). Nothing was changed.",
        );
      }
      throw error;
    }
    created++;
    logAction({
      clinicId,
      actor_id: input.requestedBy,
      action_type: "staff.clinic_requested",
      description: `Requested adding ${input.staffId} (${input.staffName}) to ${clinicName}`,
    });
    // Fire-and-forget: a failed notification must never undo the request.
    void notifyAllAdmins({
      title: "Clinic assignment awaiting approval",
      message: requestSentence({
        role: input.role,
        staffName: input.staffName,
        clinicName,
      }),
      link: "/admin/requests",
      superAdminLink: "/super-admin/requests",
    });
  }
  return {
    created,
    alreadyPending: alreadyPending.length,
    alreadyThere: alreadyThere.length,
  };
}

/** Live requests, newest first. Pending ones are what needs a decision. */
export function useClinicAssignmentRequests(): {
  requests: ClinicAssignmentRequest[];
  loading: boolean;
  error: boolean;
} {
  const [requests, setRequests] = useState<ClinicAssignmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLECTION),
      (snap) => {
        setRequests(
          snap.docs
            .map((d) => fromDoc(d.id, d.data()))
            .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
        );
        setError(false);
        setLoading(false);
      },
      (err) => {
        console.error("Clinic requests subscription failed:", err);
        setError(true);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);
  return { requests, loading, error };
}

/** Pending requests for one person, so their panel can show what is waiting. */
export function pendingFor(
  requests: ClinicAssignmentRequest[],
  staffId: string,
): ClinicAssignmentRequest[] {
  return requests.filter(
    (r) => r.staffId === staffId && r.status === "pending",
  );
}

/**
 * Approves a request: adds the clinic to the person's list, then closes the
 * request. Safe to repeat: if the second step fails the request stays pending
 * and approving again changes nothing further.
 */
export async function approveClinicRequest(
  requestId: string,
  by: string,
): Promise<void> {
  assertOnline();
  const ref = doc(db, COLLECTION, requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That request no longer exists.");
  const r = fromDoc(snap.id, snap.data());
  if (r.status !== "pending") {
    throw new Error(`This request was already ${r.status}.`);
  }
  // Read now, not from the request: they may have been moved since it was made.
  const current = await getStaffClinicIds(r.role, r.staffId);
  if (!current.includes(r.clinicId)) {
    await setStaffClinics({
      role: r.role,
      staffId: r.staffId,
      clinicIds: [...current, r.clinicId],
    });
  }
  await updateDoc(ref, {
    status: "approved" satisfies RequestStatus,
    resolvedBy: by,
    resolvedAt: new Date().toISOString(),
  });
  logAction({
    clinicId: r.clinicId,
    actor_id: by,
    action_type: "staff.clinic_approved",
    description: `Approved adding ${r.staffId} (${r.staffName}) to ${r.clinicName}`,
  });
}

/** Denies a request. Nothing about the person changes. */
export async function denyClinicRequest(
  requestId: string,
  by: string,
  reason?: string,
): Promise<void> {
  assertOnline();
  const ref = doc(db, COLLECTION, requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That request no longer exists.");
  const r = fromDoc(snap.id, snap.data());
  if (r.status !== "pending") {
    throw new Error(`This request was already ${r.status}.`);
  }
  await updateDoc(ref, {
    status: "denied" satisfies RequestStatus,
    resolvedBy: by,
    resolvedAt: new Date().toISOString(),
    ...(reason?.trim() ? { denyReason: reason.trim().slice(0, 300) } : {}),
  });
  logAction({
    clinicId: r.clinicId,
    actor_id: by,
    action_type: "staff.clinic_denied",
    description: `Denied adding ${r.staffId} (${r.staffName}) to ${r.clinicName}`,
  });
}
