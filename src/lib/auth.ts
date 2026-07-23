import { logAction } from "./audit";

export type Role =
  | "doctor"
  | "nurse"
  | "patient"
  | "pharmacist"
  | "receptionist"
  | "admin"
  | "super_admin";

const KEY = "zennith_auth";
const NAME_KEY = "zennith_username";
const USERS_KEY = "zennith_users";
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

export type StaffRole = Exclude<Role, "patient" | "super_admin">;
export const STAFF_ROLES: StaffRole[] = ["doctor", "nurse", "pharmacist", "receptionist"];

export interface StoredUser {
  username: string;
  password: string;
  role: Role;
  fullName?: string;
  createdAt: string;
  /** For staff/facility_admin: assigned facility. Not used for super_admin/patient. */
  facilityId?: string;
}

const BUILTIN: StoredUser[] = [
  ...(["doctor", "nurse", "patient", "pharmacist", "receptionist", "admin"] as Role[]).map((r) => ({
    username: r,
    password: "password",
    role: r,
    fullName: r.charAt(0).toUpperCase() + r.slice(1),
    createdAt: "2026-01-01",
    facilityId: r === "patient" ? undefined : "hillbrow",
  })),
  {
    username: "superadmin",
    password: "password",
    role: "super_admin" as Role,
    fullName: "Platform Owner",
    createdAt: "2026-01-01",
  },
];

export function getUsers(): StoredUser[] {
  if (typeof window === "undefined") return BUILTIN;
  try {
    const extra = JSON.parse(localStorage.getItem(USERS_KEY) || "[]") as StoredUser[];
    return [...BUILTIN, ...extra];
  } catch {
    return BUILTIN;
  }
}
export function getCustomUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]") as StoredUser[];
  } catch {
    return [];
  }
}
export function addUser(u: StoredUser): { ok: boolean; error?: string } {
  if (typeof window === "undefined") return { ok: false, error: "unavailable" };
  const all = getUsers();
  if (all.some((x) => x.username.toLowerCase() === u.username.toLowerCase())) {
    return { ok: false, error: "Username already exists" };
  }
  const list = getCustomUsers();
  list.push(u);
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
  logAction({
    facility_id: u.facilityId ?? null,
    actor_id: getUsername() || "system",
    action_type: "staff.create",
    description: `Created ${u.role} account "${u.username}"${u.facilityId ? ` at ${u.facilityId}` : ""}`,
  });
  return { ok: true };
}
export function removeUser(username: string) {
  if (typeof window === "undefined") return;
  const target = getCustomUsers().find((x) => x.username === username);
  const list = getCustomUsers().filter((x) => x.username !== username);
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
  logAction({
    facility_id: target?.facilityId ?? null,
    actor_id: getUsername() || "system",
    action_type: "staff.remove",
    description: `Revoked account "${username}"`,
  });
}

export function setAuth(role: Role, username?: string, facilityId?: string | null) {
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
}

export function checkCredentials(username: string, password: string): StoredUser | null {
  const u = username.trim().toLowerCase();
  const found = getUsers().find((x) => x.username.toLowerCase() === u && x.password === password);
  return found ?? null;
}

export function displayNameFor(role: Role, username: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const isGeneric = !username || username.toLowerCase() === role.toLowerCase() || username.toLowerCase() === "superadmin";
  if (isGeneric) {
    if (role === "super_admin") return "Super Admin";
    return cap(role);
  }
  const name = cap(username);
  switch (role) {
    case "doctor": return `Dr. ${name}`;
    case "nurse": return `Nurse ${name}`;
    case "pharmacist": return `Pharm. ${name}`;
    case "receptionist": return `Reception ${name}`;
    case "admin": return `Admin ${name}`;
    case "super_admin": return `${name} (Platform)`;
    case "patient": return name;
  }
}
