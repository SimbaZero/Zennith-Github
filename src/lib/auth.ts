// src/lib/auth.ts — Firebase-backed auth with facility scoping + audit logging.
// Merged: Firebase Authentication / Firestore profiles (live backend) plus the
// super_admin role, per-facility scoping, and audit trail from the platform build.
import { initializeApp, deleteApp } from "firebase/app";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  getAuth as getFbAuth,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getFirestore,
  updateDoc,
} from "firebase/firestore";
import {
  runTransactionOnline as runTransaction,
  assertOnline,
} from "@/lib/offline";
import { auth, db, firebaseConfig } from "@/firebase";
import { logAction } from "./audit";

export type Role =
  | "doctor"
  | "nurse"
  | "patient"
  | "pharmacist"
  | "receptionist"
  | "admin"
  | "super_admin";

export type StaffRole = Exclude<Role, "patient" | "super_admin">;
export const STAFF_ROLES: StaffRole[] = [
  "doctor",
  "nurse",
  "pharmacist",
  "receptionist",
];

const KEY = "zennith_auth";
const NAME_KEY = "zennith_username";
const FACILITY_KEY = "zennith_user_facility";
const ROLES: Role[] = [
  "doctor",
  "nurse",
  "patient",
  "pharmacist",
  "receptionist",
  "admin",
  "super_admin",
];

// usernames without "@" map to this domain: "doctor" -> doctor@zennith.test
const TEST_DOMAIN = "zennith.test";
const toEmail = (username: string) =>
  username.includes("@")
    ? username.trim().toLowerCase()
    : `${username.trim().toLowerCase()}@${TEST_DOMAIN}`;

// password is only used as INPUT to addUser — it is never stored in Firestore
export interface StoredUser {
  username: string;
  password?: string;
  role: Role;
  fullName?: string;
  createdAt: string;
  builtin?: boolean; // true on the seeded role accounts
  email?: string; // real contact email from the imported dataset (display only)
  legacyUserId?: number; // userId in the imported users/doctors/nurses/... collections
  clinicId?: number; // real clinic scope — set for every role now, incl. admin
  /** For staff/facility admins: assigned facility. Unused for super_admin/patient. */
  facilityId?: string;
  firstName?: string;
  lastName?: string;
  /** HPCSA (doctor) / SANC (nurse) / SAPC (pharmacist) registration number. */
  licenseNumber?: string;
  specialty?: string;
  ward?: string;
  contactNumber?: string;
  idType?: "sa_id" | "passport";
  idNumber?: string;
}

/** Roles whose licenseNumber must be checked for uniqueness on creation. */
const LICENSED_ROLES: Role[] = ["doctor", "nurse", "pharmacist"];

/* ================= LEGACY TABLES (users / doctors / nurses / ...) =================
 * The app was seeded from an imported dataset that lives alongside "profiles":
 *   - "users"        — one row per person, ANY role, keyed by a numeric legacyUserId
 *                       (fields: names, surname, role ("Doctor"/"Nurse"/...), idNumber,
 *                       contactNum, email, userId, + optional Age/DOB/Gender/city/suburb)
 *   - "doctors" / "nurses" / "pharmacists" / "receptionists"
 *                     — one row per staff member, doc ID like "Doc-12", keyed fields
 *                       {role}Id (e.g. doctorId), userId (points back to "users"),
 *                       clinicId / clinicIds, and licenseNo for doctor/pharmacist
 *                       (doctors also have "specialisation")
 *   - "adminRecords"  — one row per account created via the admin panel, doc ID is a
 *                       plain incrementing number, fields adminRecordId + userIdAdded
 * `addUser` below writes to all of these in addition to "profiles" so a new doctor
 * actually shows up in the Firestore tables the rest of the app (doctor-service.ts
 * etc.) queries — not just in the login/profile system.
 */
const ROLE_PREFIX: Partial<Record<Role, string>> = {
  doctor: "Doc",
  nurse: "Nur",
  pharmacist: "Pharm",
  receptionist: "Rec",
};
const ROLE_COLLECTION: Partial<Record<Role, string>> = {
  doctor: "doctors",
  nurse: "nurses",
  pharmacist: "pharmacists",
  receptionist: "receptionists",
};
const ROLE_ID_FIELD: Partial<Record<Role, string>> = {
  doctor: "doctorId",
  nurse: "nurseId",
  pharmacist: "pharmacistId",
  receptionist: "receptionistId",
};

/** users.userId is numeric, so we can let Firestore do the sort/limit for us. */
async function nextLegacyUserId(firestore = db): Promise<number> {
  const q = query(
    collection(firestore, "users"),
    orderBy("userId", "desc"),
    limit(1),
  );
  const snap = await getDocs(q);
  const max = snap.empty ? 0 : ((snap.docs[0].data().userId as number) ?? 0);
  return max + 1;
}

/** Role tables are keyed like "Doc-12" (string doc IDs), which Firestore can't
 *  sort numerically, so we scan the collection and take the highest suffix.
 *  Fine at this data size; if these collections grow large, replace with a
 *  dedicated counter document instead. */
async function nextRoleRecordId(
  role: StaffRole,
  firestore = db,
): Promise<string> {
  const prefix = ROLE_PREFIX[role]!;
  const coll = ROLE_COLLECTION[role]!;
  const snap = await getDocs(collection(firestore, coll));
  let max = 0;
  for (const d of snap.docs) {
    const m = /^([A-Za-z]+)-(\d+)$/.exec(d.id);
    if (m && m[1] === prefix) max = Math.max(max, parseInt(m[2], 10));
  }
  return `${prefix}-${max + 1}`;
}

/** adminRecords doc IDs are plain numeric strings — same scan-based approach. */
async function nextAdminRecordId(firestore = db): Promise<number> {
  const snap = await getDocs(collection(firestore, "adminRecords"));
  let max = 0;
  for (const d of snap.docs) {
    const n = Number(d.id);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return max + 1;
}

// Login profiles live in "profiles" (keyed by Firebase Auth UID), NOT in the
// imported "users" collection (keyed by numeric legacy userId).
const USERS = "profiles";

/* ================= CREDENTIALS (Firebase Auth) ================= */

/** Verifies the password with Firebase Auth, then reads the role (and assigned
 *  facility, if any) from the user's Firestore profile. */
export async function checkCredentials(
  username: string,
  password: string,
): Promise<{
  role: Role;
  facilityId?: string | null;
  legacyUserId?: number | null;
} | null> {
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      toEmail(username),
      password,
    );
    const snap = await getDoc(doc(db, USERS, cred.user.uid));
    if (!snap.exists()) {
      console.warn("Auth OK but no Firestore profile for uid:", cred.user.uid);
      return null;
    }
    const data = snap.data();
    const role = data.role as Role;
    if (!ROLES.includes(role)) return null;
    return {
      role,
      facilityId: data.facilityId ?? null,
      legacyUserId: data.legacyUserId ?? null,
    };
  } catch (err: any) {
    console.error("Login failed:", err.code);
    return null;
  }
}

/** Sends a real Firebase password reset email. Always resolves (never
 *  reveals whether the email exists, for security). */
export async function sendPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  } catch (err) {
    console.warn("sendPasswordReset:", err);
    // Deliberately swallow errors here too — same "don't reveal if the
    // account exists" reasoning as the UI message itself.
  }
}

/* ================= USER CRUD (Firestore) ================= */

export async function getUsers(): Promise<StoredUser[]> {
  try {
    const snap = await getDocs(collection(db, USERS));
    return snap.docs.map((d) => d.data() as StoredUser);
  } catch (err) {
    console.error("getUsers failed:", err);
    return [];
  }
}

export async function getCustomUsers(): Promise<StoredUser[]> {
  const all = await getUsers();
  return all.filter((u) => !u.builtin);
}

/** True if some existing profile already has this exact licenseNumber.
 *  Pass excludeUsername to ignore a user editing their own record. */
export async function licenseNumberExists(
  licenseNumber: string,
  excludeUsername?: string,
): Promise<boolean> {
  const value = licenseNumber.trim().toUpperCase();
  if (!value) return false;
  const q = query(collection(db, USERS), where("licenseNumber", "==", value));
  const snap = await getDocs(q);
  return snap.docs.some(
    (d) =>
      (d.data().username as string | undefined)?.toLowerCase() !==
      excludeUsername?.trim().toLowerCase(),
  );
}

/** True if some existing profile already has this exact SA ID / passport
 *  number. Checked regardless of idType, since the two shouldn't collide. */
export async function idNumberExists(
  idNumber: string,
  excludeUsername?: string,
): Promise<boolean> {
  const value = idNumber.trim();
  if (!value) return false;
  const q = query(collection(db, USERS), where("idNumber", "==", value));
  const snap = await getDocs(q);
  return snap.docs.some(
    (d) =>
      (d.data().username as string | undefined)?.toLowerCase() !==
      excludeUsername?.trim().toLowerCase(),
  );
}

// Creates the account on a throwaway secondary app instance: Firebase signs in
// as any newly created user, so using the primary `auth` here would silently
// replace the admin's session with the new user's.
const STAFF_META: Partial<
  Record<
    StaffRole,
    {
      collection: string;
      idField: string;
      prefix: string;
      counterField: string;
      multiClinic: boolean;
    }
  >
> = {
  doctor: {
    collection: "doctors",
    idField: "doctorId",
    prefix: "Doc",
    counterField: "doctorNo",
    multiClinic: true,
  },
  nurse: {
    collection: "nurses",
    idField: "nurseId",
    prefix: "Nur",
    counterField: "nurseNo",
    multiClinic: false,
  },
  pharmacist: {
    collection: "pharmacists",
    idField: "pharmacistId",
    prefix: "Pharm",
    counterField: "pharmacistNo",
    multiClinic: true,
  },
  receptionist: {
    collection: "receptionists",
    idField: "receptionistId",
    prefix: "Rec",
    counterField: "receptionistNo",
    multiClinic: false,
  },
};

export async function addUser(u: {
  username: string;
  email: string; // real address — where the set-password link is sent
  role: StaffRole; // now includes "admin" — see the branch below
  fullName?: string;
<<<<<<< Updated upstream
  clinicId?: number;
}): Promise<{ ok: boolean; error?: string }> {
  // Creating a staff account calls Firebase Auth and sends a set-password
  // email — neither of which is a Firestore write, so neither can be queued
  // offline. Without this the admin would watch the form hang and have no
  // idea whether an account now exists.
  assertOnline();
  if (u.clinicId == null) {
    return { ok: false, error: "A clinic must be selected." };
  }

  // The admin never chooses or sees this. It exists only so the Firebase
  // account can be created; the new staff member immediately sets their own
  // via the reset link below. Previously the admin picked the password and
  // read it out — meaning an admin permanently knew a clinician's login,
  // which makes it impossible to tell who actually accessed a patient record.
  const throwawayPassword =
    crypto.randomUUID() + crypto.randomUUID().toUpperCase();

=======
  firstName?: string;
  lastName?: string;
  facilityId?: string;
  licenseNumber?: string;
  specialty?: string;
  ward?: string;
  contactNumber?: string;
  idType?: "sa_id" | "passport";
  idNumber?: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Validate uniqueness BEFORE touching Firebase Auth — if we checked
  // after creating the Auth account, a duplicate would leave behind an
  // orphaned Auth user with no Firestore profile (the account exists,
  // can log in, but has no role/facility). Doing it here catches
  // duplicates while it's still cheap to just return an error.
  if (u.licenseNumber && LICENSED_ROLES.includes(u.role)) {
    if (await licenseNumberExists(u.licenseNumber)) {
      return {
        ok: false,
        error: `Registration number "${u.licenseNumber.trim().toUpperCase()}" is already assigned to another staff member`,
      };
    }
  }
  if (u.idNumber) {
    if (await idNumberExists(u.idNumber)) {
      return {
        ok: false,
        error:
          u.idType === "passport"
            ? `Passport number "${u.idNumber.trim()}" is already registered to another user`
            : `ID number "${u.idNumber.trim()}" is already registered to another user`,
      };
    }
  }

>>>>>>> Stashed changes
  const secondary = initializeApp(
    firebaseConfig,
    `user-creation-${Date.now()}`,
  );
  try {
    let legacyUserId: number | undefined;
    let staffId: string | undefined;

    if (u.role === "admin") {
      // Admin doesn't need a numbered staff record like Doc-###/Nur-### —
      // it's an access scope, not a clinical identity referenced anywhere
      // else in the data. clinicId lives directly on the profile instead.
    } else {
      const meta = STAFF_META[u.role];
      if (!meta) {
        return {
          ok: false,
          error: `"${u.role}" isn't a role that can be created here.`,
        };
      }
      // Reserve a real users.userId and this role's next Doc-###/Nur-###/
      // etc., in one transaction against the same counters/registration doc
      // signUpPatient() already uses for patients. Starting numbers were set
      // safely from real data by scripts/setup-staff-id-counters.mjs.
      const reserved = await runTransaction(db, async (tx) => {
        const ref = doc(db, "counters", "registration");
        const snap = await tx.get(ref);
        const cur = snap.exists()
          ? (snap.data() as Record<string, number>)
          : {};
        const nextUserId = (cur.userNo ?? 90000) + 1;
        const nextStaffNo = (cur[meta.counterField] ?? 0) + 1;
        tx.set(
          ref,
          { ...cur, userNo: nextUserId, [meta.counterField]: nextStaffNo },
          { merge: true },
        );
        return { userId: nextUserId, staffId: `${meta.prefix}-${nextStaffNo}` };
      });
      legacyUserId = reserved.userId;
      staffId = reserved.staffId;

      // Real users record — same shape signUpPatient() already writes.
      await setDoc(doc(db, "users", String(legacyUserId)), {
        userId: legacyUserId,
        names: u.fullName ?? "",
        surname: "",
        role: u.role.charAt(0).toUpperCase() + u.role.slice(1),
      });

      // Real role-specific record.
      await setDoc(doc(db, meta.collection, staffId), {
        [meta.idField]: staffId,
        userId: legacyUserId,
        clinicId: u.clinicId,
        ...(meta.multiClinic ? { clinicIds: [u.clinicId] } : {}),
      });
    }

    const cred = await createUserWithEmailAndPassword(
      getFbAuth(secondary),
      u.email.trim().toLowerCase(),
      throwawayPassword,
    );
<<<<<<< Updated upstream

    // Real profile. Doctor/nurse/pharmacist/receptionist link via
    // legacyUserId; admin carries clinicId directly since it has no
    // separate staff record to link to.
    await setDoc(doc(getFirestore(secondary), USERS, cred.user.uid), {
=======
    const secondaryDb = getFirestore(secondary);

    // Legacy-table IDs are allocated against the ADMIN's own session
    // (primary `db`) rather than the brand-new user's session.
    const legacyUserId = await nextLegacyUserId(db);
    const roleCapitalized = u.role.charAt(0).toUpperCase() + u.role.slice(1);

    await setDoc(doc(secondaryDb, USERS, cred.user.uid), {
>>>>>>> Stashed changes
      username: u.username.trim().toLowerCase(),
      role: u.role,
      fullName: u.fullName ?? "",
      createdAt: new Date().toISOString(),
      builtin: false,
<<<<<<< Updated upstream
      clinicId: u.clinicId,
      email: u.email.trim().toLowerCase(),
      ...(legacyUserId != null ? { legacyUserId } : {}),
    });

    // Firebase's own password-reset email doubles as the invite: the new
    // staff member follows it and sets a password only they ever know.
    // This uses Firebase's built-in sender (free, works for any address) —
    // not Resend, which still needs a verified domain.
    try {
      await sendPasswordResetEmail(auth, u.email.trim().toLowerCase());
    } catch (err) {
      console.error("Invite email failed to send:", err);
      // Account is already created and valid — don't fail the whole thing.
      // The admin can resend from the staff list.
=======
      legacyUserId,
      ...(u.facilityId ? { facilityId: u.facilityId } : {}),
      ...(u.firstName ? { firstName: u.firstName.trim() } : {}),
      ...(u.lastName ? { lastName: u.lastName.trim() } : {}),
      ...(u.licenseNumber
        ? { licenseNumber: u.licenseNumber.trim().toUpperCase() }
        : {}),
      ...(u.specialty ? { specialty: u.specialty.trim() } : {}),
      ...(u.ward ? { ward: u.ward.trim() } : {}),
      ...(u.contactNumber ? { contactNumber: u.contactNumber.trim() } : {}),
      ...(u.idType ? { idType: u.idType } : {}),
      ...(u.idNumber ? { idNumber: u.idNumber.trim() } : {}),
    });

    // Everything below writes via the PRIMARY `db` — i.e. still
    // authenticated as the ADMIN, not the brand-new user on `secondaryDb`.
    // "doctors" / "nurses" / "pharmacists" / "adminRecords" are admin-only
    // per your Firestore rules, so writing them under the new user's own
    // (permission-less) session was rejected with permission-denied even
    // though the Auth account + profile above had already been created —
    // that's the "access denied" you were seeing on an account that had,
    // in fact, partially been created.
    //
    // Wrapped in its own try/catch: if a rule still blocks one of these,
    // the account + login (created above) remain valid — we don't want a
    // legacy-table hiccup to make the UI claim the whole thing failed.
    try {
      // "users" — shared legacy table every role record points back to.
      await setDoc(doc(db, "users", String(legacyUserId)), {
        userId: legacyUserId,
        names: u.firstName?.trim() ?? "",
        surname: u.lastName?.trim() ?? "",
        role: roleCapitalized,
        email: toEmail(u.username),
        ...(u.contactNumber ? { contactNum: u.contactNumber.trim() } : {}),
        ...(u.idNumber ? { idNumber: u.idNumber.trim() } : {}),
      });

      // Role-specific table ("doctors" / "nurses" / "pharmacists" / "receptionists").
      const coll = ROLE_COLLECTION[u.role];
      if (coll) {
        const roleRecordId = await nextRoleRecordId(u.role as StaffRole, db);
        const clinicIdNum = u.facilityId ? Number(u.facilityId) : undefined;
        const clinicIdValue =
          clinicIdNum !== undefined && !Number.isNaN(clinicIdNum)
            ? clinicIdNum
            : u.facilityId;
        await setDoc(doc(db, coll, roleRecordId), {
          [ROLE_ID_FIELD[u.role]!]: roleRecordId,
          userId: legacyUserId,
          ...(clinicIdValue !== undefined
            ? { clinicId: clinicIdValue, clinicIds: [clinicIdValue] }
            : {}),
          ...(u.licenseNumber
            ? { licenseNo: u.licenseNumber.trim().toUpperCase() }
            : {}),
          ...(u.role === "doctor" && u.specialty
            ? { specialisation: u.specialty.trim() }
            : {}),
        });
      }

      // "adminRecords" — audit trail of accounts created via this panel.
      const adminRecordId = await nextAdminRecordId(db);
      await setDoc(doc(db, "adminRecords", String(adminRecordId)), {
        adminRecordId,
        timeStampCreated: new Date().toISOString(),
        userIdAdded: legacyUserId,
      });
    } catch (legacyErr: any) {
      // Account + profile are already good at this point — don't fail the
      // whole operation over a secondary table. Surface it in the console
      // so it's not silently lost, though.
      console.error(
        "addUser: legacy table sync (users/role table/adminRecords) failed:",
        legacyErr.code ?? legacyErr.message ?? legacyErr,
      );
>>>>>>> Stashed changes
    }

    logAction({
      clinicId: u.clinicId,
      actor_id: getUsername() || "system",
      action_type: "staff.create",
      description: `Created ${u.role} account "${u.username}"${staffId ? ` (${staffId})` : ""} at clinicId ${u.clinicId}`,
    });
    return { ok: true };
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use")
      return { ok: false, error: "Username already exists" };
    if (err.code === "auth/weak-password")
      return { ok: false, error: "Password must be at least 6 characters" };
    if (err.code === "auth/operation-not-allowed")
      return {
        ok: false,
        error: "Email/Password sign-in is not enabled in Firebase",
      };
    console.error("addUser failed:", err.code, err.message);
    return {
      ok: false,
      error: `Could not create account (${err.code ?? err.message ?? "unknown"})`,
    };
  } finally {
    await deleteApp(secondary);
  }
}

// Deletes the Firestore profile (blocks login role lookup).
// NOTE: the Firebase Auth record itself can only be deleted from the
// console or an Admin SDK backend — client apps can't delete other users.
export async function removeUser(username: string): Promise<void> {
  // Revoking someone's access is a security action: it has to be true on the
  // server, now. "Removed" that actually means "removed once this laptop
  // reconnects" would leave a login working that an admin believes is gone.
  assertOnline();
  try {
    const q = query(
      collection(db, USERS),
      where("username", "==", username.trim().toLowerCase()),
    );
    const snap = await getDocs(q);
    // Fall back to the acting admin's own clinic. Some profiles carry no
    // clinicId of their own, which logged the removal as "Platform-wide" —
    // so the event disappeared when Super Admin filtered by clinic, even
    // though it plainly happened at one.
    const actingProfile = auth.currentUser
      ? await getDoc(doc(db, USERS, auth.currentUser.uid))
      : null;
    const actingClinicId = actingProfile?.exists()
      ? (actingProfile.data().clinicId as number | undefined)
      : undefined;
    const removedClinicId =
      (snap.docs[0]?.data()?.clinicId as number | undefined) ??
      actingClinicId ??
      null;
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    logAction({
      clinicId: removedClinicId,
      actor_id: getUsername() || "system",
      action_type: "staff.remove",
      description: `Revoked account "${username}"`,
    });
  } catch (err) {
    console.error("removeUser failed:", err);
  }
}

/* ================= TWO-FACTOR (TOTP secret on the profile) ================= */

/** The signed-in user's TOTP secret, or null if 2FA is not yet enrolled. */
export async function fetchTotpSecret(): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const snap = await getDoc(doc(db, USERS, uid));
  return snap.exists() ? (snap.data().totpSecret ?? null) : null;
}

/** Stores the TOTP secret on the signed-in user's profile (called once, at enrollment). */
export async function saveTotpSecret(secret: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  await updateDoc(doc(db, USERS, uid), { totpSecret: secret });
}

/**
 * Clears the stored TOTP secret so the account can re-enroll a new
 * authenticator (e.g. lost phone, deleted the authenticator app).
 * Safe to expose here because reaching this screen already required a
 * correct email + password — this is a recovery step, not a bypass.
 */
export async function resetTotpSecret(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in");
  await updateDoc(doc(db, USERS, uid), { totpSecret: null });
}

/* ================= SESSION (localStorage cache for route guards) ================= */

export function setAuth(
  role: Role,
  username?: string,
  facilityId?: string | null,
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, role);
  if (username) localStorage.setItem(NAME_KEY, username);
  if (facilityId) localStorage.setItem(FACILITY_KEY, facilityId);
  else localStorage.removeItem(FACILITY_KEY);
}
export function getAuth(): Role | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY) as Role | null;
  return v && ROLES.includes(v) ? v : null;
}
export function getUsername(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NAME_KEY) || "";
}
/** The facility (clinic) the signed-in user is scoped to; null = platform-wide. */
export function getUserFacility(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(FACILITY_KEY);
}
export function clearAuth() {
  if (typeof window !== "undefined") {
    const u = getUsername();
    if (u) {
      logAction({
        clinicId: null,
        actor_id: u,
        action_type: "auth.logout",
        description: `User "${u}" signed out`,
      });
    }
    localStorage.removeItem(KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(FACILITY_KEY);
  }
  fbSignOut(auth).catch(() => {});
}

/* ================= DISPLAY ================= */

export function displayNameFor(role: Role, username: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const isGeneric =
    !username ||
    username.toLowerCase() === role.toLowerCase() ||
    username.toLowerCase() === "superadmin";
  if (isGeneric) {
    if (role === "super_admin") return "Super Admin";
    return cap(role);
  }
  const name = cap(username);
  switch (role) {
    case "doctor":
      return `Dr. ${name}`;
    case "nurse":
      return `Nurse ${name}`;
    case "pharmacist":
      return `Pharm. ${name}`;
    case "receptionist":
      return `Reception ${name}`;
    case "admin":
      return `Admin ${name}`;
    case "super_admin":
      return `${name} (Platform)`;
    case "patient":
      return name;
  }
<<<<<<< Updated upstream
}

/* ================= CURRENT ADMIN (real clinic scoping) ================= */

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

export interface CurrentAdmin {
  clinicId?: number;
  clinicName?: string;
  fullName: string;
  username: string;
  /**
   * Firestore profile document id. Admins are addressed by this rather than
   * a numeric users.userId, because an admin is an access scope, not a
   * clinical identity — they have no `users` record, and creating one just
   * to carry notifications would duplicate data for no reason.
   */
  profileId?: string;
}

/**
 * Resolves the signed-in admin's real clinic. Unlike doctors/nurses, admin
 * has no separate staff record — clinicId lives directly on the profile,
 * since an admin ID is never referenced elsewhere in the data.
 */
export function useCurrentAdmin(): {
  admin: CurrentAdmin | null;
  loading: boolean;
  error: string | null;
} {
  const [admin, setAdmin] = useState<CurrentAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (!cancelled) {
          setAdmin(null);
          setError("Not signed in");
          setLoading(false);
        }
        return;
      }
      try {
        const snap = await getDoc(doc(db, USERS, user.uid));
        const data = snap.exists() ? snap.data() : {};
        let clinicName: string | undefined;
        if (data.clinicId != null) {
          const c = await getDoc(doc(db, "clinics", String(data.clinicId)));
          if (c.exists()) clinicName = c.data().clinicName;
        }
        if (!cancelled) {
          setAdmin({
            clinicId: data.clinicId,
            clinicName,
            fullName: data.fullName || data.username || "Admin",
            username: data.username ?? "",
            profileId: user.uid,
          });
          setLoading(false);
        }
      } catch (err: any) {
        console.error("Failed to resolve current admin:", err);
        if (!cancelled) {
          setError(err.message ?? "Could not load admin profile");
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { admin, loading, error };
}
/**
 * Creates a login for someone who ALREADY exists as staff.
 *
 * Distinct from addUser, which creates a brand-new person. Without this, an
 * admin looking at "Aisha Botha · Doc-99 · No login" had to go to Create User
 * and retype her details — which would mint a second doctor record, Doc-107,
 * with none of her history. The same human would then exist twice, and
 * whichever record her appointments pointed at would be the one she couldn't
 * see when she logged in.
 *
 * This attaches an Auth account to the existing staff record instead.
 */
export async function createLoginForExistingStaff(input: {
  staffId: string; // e.g. "Doc-99"
  role: StaffRole;
  username: string;
  email: string;
  fullName: string;
  userId: number; // the staff record's existing users.userId
  clinicId: number;
}): Promise<{ ok: boolean; error?: string }> {
  // Same as addUser — real Firebase Auth calls plus a set-password email,
  // none of which Firestore's offline queue covers.
  assertOnline();
  const throwawayPassword =
    crypto.randomUUID() + crypto.randomUUID().toUpperCase();

  const secondary = initializeApp(firebaseConfig, `staff-login-${Date.now()}`);
  try {
    const cred = await createUserWithEmailAndPassword(
      getFbAuth(secondary),
      input.email.trim().toLowerCase(),
      throwawayPassword,
    );

    // Links to the EXISTING record via legacyUserId — no new staff document
    // is created, so their appointments, notes and history stay attached.
    await setDoc(doc(getFirestore(secondary), USERS, cred.user.uid), {
      username: input.username.trim().toLowerCase(),
      role: input.role,
      fullName: input.fullName,
      email: input.email.trim().toLowerCase(),
      createdAt: new Date().toISOString(),
      builtin: false,
      clinicId: input.clinicId,
      legacyUserId: input.userId,
    });

    try {
      await sendPasswordResetEmail(auth, input.email.trim().toLowerCase());
    } catch (err) {
      console.error("Invite email failed to send:", err);
    }

    logAction({
      clinicId: input.clinicId,
      actor_id: getUsername() || "system",
      action_type: "staff.login_created",
      description: `Created a login for existing ${input.role} ${input.staffId} (${input.fullName})`,
    });

    return { ok: true };
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use")
      return { ok: false, error: "That email already has an account" };
    if (err.code === "auth/invalid-email")
      return { ok: false, error: "Enter a valid email address" };
    console.error("createLoginForExistingStaff failed:", err.code, err.message);
    return {
      ok: false,
      error: `Could not create login (${err.code ?? "unknown"})`,
    };
  } finally {
    await deleteApp(secondary);
  }
}
/**
 * Lets an admin correct a staff member's display name or contact email.
 *
 * Deliberately narrow. Role and clinic are NOT editable here: changing
 * either would silently move someone between clinics or hand them different
 * access, which should be a deliberate remove-and-recreate rather than an
 * inline edit. Passwords aren't editable either — an admin should never be
 * able to set or see one, which is the whole point of the invite flow.
 *
 * Fixing a typo previously meant deleting the account and starting over,
 * which threw away their linked staff record and history.
 */
export async function updateStaffDetails(input: {
  username: string;
  fullName: string;
  email?: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Looks the account up by username before writing; offline that query
  // misses and the admin is told the staff member doesn't exist. Changing an
  // email address also touches the auth record, not just Firestore.
  assertOnline();
  const name = input.fullName.trim();
  if (!name) return { ok: false, error: "Name can't be empty." };

  try {
    const snap = await getDocs(
      query(
        collection(db, USERS),
        where("username", "==", input.username.trim().toLowerCase()),
      ),
    );
    if (snap.empty)
      return { ok: false, error: "That account no longer exists." };

    const profileRef = snap.docs[0].ref;
    const profile = snap.docs[0].data();

    await updateDoc(profileRef, {
      fullName: name,
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
    });

    // The users record holds the name the rest of the app actually reads —
    // staff lists, appointments, handover notes all resolve names from
    // there, so updating only the profile would leave the old name showing
    // everywhere that matters.
    if (profile.legacyUserId != null) {
      const [names, ...rest] = name.split(/\s+/);
      await setDoc(
        doc(db, "users", String(profile.legacyUserId)),
        {
          names,
          surname: rest.join(" "),
          ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
        },
        { merge: true },
      );
    }

    logAction({
      clinicId: profile.clinicId ?? null,
      actor_id: getUsername() || "system",
      action_type: "staff.update",
      description: `Updated details for "${input.username}" (name: ${name})`,
    });

    return { ok: true };
  } catch (err: any) {
    console.error("updateStaffDetails failed:", err);
    return { ok: false, error: "Could not save those changes." };
  }
}
=======
}
>>>>>>> Stashed changes
