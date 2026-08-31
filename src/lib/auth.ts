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
  getFirestore,
  updateDoc,
  runTransaction,
} from "firebase/firestore";
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
  clinicId?: number;
}): Promise<{ ok: boolean; error?: string }> {
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

    // Real profile. Doctor/nurse/pharmacist/receptionist link via
    // legacyUserId; admin carries clinicId directly since it has no
    // separate staff record to link to.
    await setDoc(doc(getFirestore(secondary), USERS, cred.user.uid), {
      username: u.username.trim().toLowerCase(),
      role: u.role,
      fullName: u.fullName ?? "",
      createdAt: new Date().toISOString(),
      builtin: false,
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
  try {
    const q = query(
      collection(db, USERS),
      where("username", "==", username.trim().toLowerCase()),
    );
    const snap = await getDocs(q);
    const removedClinicId =
      (snap.docs[0]?.data()?.clinicId as number | undefined) ?? null;
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
