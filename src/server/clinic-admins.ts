// Server-only: which admins look after a clinic, for sending them a notification.
//
// A browser can no longer read other people's `profiles` documents (the rules
// allow staff and the owner only), but a patient asking to be deactivated must
// still reach their clinic's admins, and reception and pharmacy do the same for
// their own alerts. So the lookup happens here, as the service account, and only
// the admins' profile ids go back: no names, e-mail addresses or anything else
// from the profile.
//
// The caller is identified by their Firebase ID token. A patient can only ask
// about their own clinic (from their own patient record, compared as a clinic
// id in either number or text form); staff can ask about any clinic.
import { clinicIdVariants, sameClinicId } from "../lib/clinic-id";
import type { ClinicAdminsResult } from "../lib/clinic-admins";
import { verifyIdToken } from "./firebase-auth";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
} from "./firestore-admin";

const STAFF_ROLES = [
  "doctor",
  "nurse",
  "pharmacist",
  "receptionist",
  "admin",
  "super_admin",
];

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

export async function findClinicAdminIds(
  idToken: unknown,
  rawClinicId: unknown,
  env?: unknown,
): Promise<ClinicAdminsResult> {
  const fs = adminOrNull(env);
  if (!fs) return { ok: false, reason: "not-configured" };

  const uid = await verifyIdToken(idToken, fs.projectId);
  if (!uid) return { ok: false, reason: "unauthenticated" };
  return adminIdsFor(fs, uid, rawClinicId);
}

/** The part after the caller is known; split out so it can be tested. */
export async function adminIdsFor(
  fs: Pick<FirestoreAdmin, "get" | "query">,
  uid: string,
  rawClinicId: unknown,
): Promise<ClinicAdminsResult> {
  const clinicId = Number(rawClinicId);
  if (rawClinicId === "" || rawClinicId == null || !Number.isFinite(clinicId))
    return { ok: false, reason: "not-eligible" };

  const profile = (await fs.get("profiles", uid))?.data;
  const role = typeof profile?.role === "string" ? profile.role : "";
  if (role === "patient") {
    const patientId =
      typeof profile?.patientId === "string" ? profile.patientId : "";
    const patient = patientId
      ? (await fs.get("patients", patientId))?.data
      : null;
    if (!patient || !sameClinicId(patient.clinicId, clinicId))
      return { ok: false, reason: "not-eligible" };
  } else if (!STAFF_ROLES.includes(role)) {
    return { ok: false, reason: "not-eligible" };
  }

  // clinicId is a number on most profiles and text on a few.
  const rows = await fs.query("profiles", [
    { field: "role", op: "EQUAL", value: "admin" },
    { field: "clinicId", op: "IN", value: clinicIdVariants(clinicId) },
  ]);
  return { ok: true, adminIds: rows.map((r) => r.id) };
}
