// src/lib/auth.ts — Firebase-backed auth with facility scoping + audit logging.
// Merged: Firebase Authentication / Firestore profiles (live backend) plus the
// super_admin role, per-facility scoping, and audit trail from the platform build.
import { initializeApp, deleteApp } from "firebase/app";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
): Promise<{ role: Role; facilityId?: string | null } | null> {
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
    return { role, facilityId: data.facilityId ?? null };
  } catch (err: any) {
    console.error("Login failed:", err.code);
    return null;
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
export async function addUser(u: {
  username: string;
  password: string;
  role: Role;
  fullName?: string;
  facilityId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const secondary = initializeApp(
    firebaseConfig,
    `user-creation-${Date.now()}`,
  );
  try {
    const cred = await createUserWithEmailAndPassword(
      getFbAuth(secondary),
      toEmail(u.username),
      u.password,
    );
    await setDoc(doc(getFirestore(secondary), USERS, cred.user.uid), {
      username: u.username.trim().toLowerCase(),
      role: u.role,
      fullName: u.fullName ?? "",
      createdAt: new Date().toISOString(),
      builtin: false,
      ...(u.facilityId ? { facilityId: u.facilityId } : {}),
    });
    logAction({
      facility_id: u.facilityId ?? null,
      actor_id: getUsername() || "system",
      action_type: "staff.create",
      description: `Created ${u.role} account "${u.username}"${u.facilityId ? ` at ${u.facilityId}` : ""}`,
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
    const facilityId =
      (snap.docs[0]?.data()?.facilityId as string | undefined) ?? null;
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    logAction({
      facility_id: facilityId,
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
        facility_id: getUserFacility(),
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
