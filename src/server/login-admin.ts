// Server-only: deleting a leftover sign-in account (Firebase Auth) so the
// e-mail address can be used again. Called through src/lib/login-admin.ts.
//
// Safeguards, because this deletes a person's login:
//   - the caller must be a signed-in admin or super admin (verified token +
//     their profile's role);
//   - the account is only deleted if it has NO profile: an account that is
//     still in use is never touched, whatever is asked;
//   - an admin can't delete their own login;
//   - when found by e-mail alone (not by the uid of a profile just removed), the
//     account must be more than two minutes old, so a sign-up that is still being
//     set up (login created, profile not yet written) is never caught.
import type { ReleaseLoginResult } from "../lib/login-admin";
import { normaliseIdentifier } from "../lib/login-identifier";
import { verifyIdToken } from "./firebase-auth";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
} from "./firestore-admin";

const MIN_AGE_MS = 2 * 60_000;

type Fs = Pick<FirestoreAdmin, "get" | "identity" | "projectId">;

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

export async function releaseLogin(args: {
  idToken: unknown;
  uid?: unknown;
  email?: unknown;
  env?: unknown;
}): Promise<ReleaseLoginResult> {
  const fs = adminOrNull(args.env);
  if (!fs) return { ok: false, reason: "not-configured" };
  const caller = await verifyIdToken(args.idToken, fs.projectId);
  if (!caller) return { ok: false, reason: "unauthenticated" };
  return releaseLoginFor(fs, caller, args);
}

/** The part after the caller is known; split out so it can be tested. */
export async function releaseLoginFor(
  fs: Fs,
  callerUid: string,
  args: { uid?: unknown; email?: unknown },
  now = Date.now(),
): Promise<ReleaseLoginResult> {
  const role = (await fs.get("profiles", callerUid))?.data.role;
  if (role !== "admin" && role !== "super_admin") {
    return { ok: false, reason: "not-eligible" };
  }

  return removeLoginAccount(fs, callerUid, args, now);
}

/**
 * Deletes a leftover login found by e-mail, with no check on who is asking: for
 * server code that has already decided the caller may create a login for this
 * address (a patient invite from reception). The same safeguards apply - it
 * only ever removes an account that has no profile and is not brand new.
 */
export async function deleteLeftoverLogin(
  fs: Fs,
  email: string,
  now = Date.now(),
): Promise<ReleaseLoginResult> {
  return removeLoginAccount(fs, "", { email }, now);
}

async function removeLoginAccount(
  fs: Fs,
  callerUid: string,
  args: { uid?: unknown; email?: unknown },
  now: number,
): Promise<ReleaseLoginResult> {
  const uid = typeof args.uid === "string" ? args.uid.trim() : "";
  const email = normaliseIdentifier(
    typeof args.email === "string" ? args.email : "",
  );
  if (!uid && !email) return { ok: false, reason: "lookup-failed" };

  const found = await fs.identity(
    "accounts:lookup",
    uid ? { localId: [uid] } : { email: [email] },
  );
  if (!found.ok) {
    console.error("[login-admin] account lookup failed:", found.status);
    return { ok: false, reason: "lookup-failed" };
  }
  const user = Array.isArray(found.json.users) ? found.json.users[0] : null;
  // Nothing there: the address is already free.
  if (!user?.localId) return { ok: true, deleted: false };

  const target = String(user.localId);
  if (callerUid && target === callerUid) return { ok: false, reason: "self" };
  if ((await fs.get("profiles", target)) !== null) {
    return { ok: false, reason: "still-in-use" };
  }
  if (!uid) {
    const created = Number(user.createdAt);
    if (!Number.isFinite(created) || now - created < MIN_AGE_MS) {
      return { ok: false, reason: "too-new" };
    }
  }

  const removed = await fs.identity("accounts:delete", { localId: target });
  if (!removed.ok) {
    console.error("[login-admin] account delete failed:", removed.status);
    return { ok: false, reason: "server-error" };
  }
  return { ok: true, deleted: true };
}
