import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  getAuth as getFbAuth,
} from "firebase/auth";
import { auth, db, firebaseConfig } from "@/firebase";
import { logAction, useLogs } from "@/lib/audit";
import { getUsername } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Facilities (clinics) — live subscription. Used on the dashboard and the
// Facilities page.
// ---------------------------------------------------------------------------

export interface Facility {
  clinicId: number;
  clinicName: string;
  type: string;
  coordinates?: string;
}

export function useClinics(): {
  clinics: Facility[];
  loading: boolean;
  error: string | null;
} {
  const [clinics, setClinics] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const q = query(collection(db, "clinics"), orderBy("clinicId"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows: Facility[] = snapshot.docs.map((d) => {
          const c = d.data();
          return {
            clinicId: Number(c.clinicId),
            clinicName: c.clinicName ?? d.id,
            type: c.type ?? "",
            coordinates: c.Coordinates ?? c.coordinates,
          };
        });
        setClinics(rows);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Failed to load clinics:", err);
        setError(err.message ?? "Could not load facilities");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  return { clinics, loading, error };
}

// ---------------------------------------------------------------------------
// Dashboard — combines facilities + audit logs + derived stats.
//
// Audit data comes from useLogs() in @/lib/audit — the same hook the audit
// page uses — rather than a separate query here. There used to be a second,
// duplicate audit hook in this file; it read the same "systemAudit"
// collection but with no row limit and slightly different timestamp
// handling, so its count could silently drift from what the audit page
// showed. Removed in favor of one shared source of truth.
// ---------------------------------------------------------------------------

export interface SuperAdminDashboardData {
  facilitiesCount: number;
  events24h: number;
  auditEntriesCount: number;
}

export function useSuperAdminDashboard(): {
  data: SuperAdminDashboardData | null;
  loading: boolean;
  error: string | null;
} {
  const { clinics, loading: clinicsLoading, error: clinicsError } =
    useClinics();
  // Platform-wide (clinicId undefined), same call the audit page makes.
  // Note: useLogs caps at 200 rows by default, so this "AUDIT ENTRIES"
  // stat reflects the most recent 200, not a true unbounded all-time
  // count. Fine while the log is small; would need a separate aggregate
  // (e.g. a counter doc updated by a Cloud Function) if that stops holding.
  const { rows: logs, loading: logsLoading, error: logsError } =
    useLogs(undefined);

  const loading = clinicsLoading || logsLoading;
  const error = clinicsError ?? logsError;

  if (loading) {
    return { data: null, loading, error };
  }

  const events24h = logs.filter(
    (l) => Date.now() - new Date(l.timestamp).getTime() < 86_400_000,
  ).length;

  return {
    data: {
      facilitiesCount: clinics.length,
      events24h,
      auditEntriesCount: logs.length,
    },
    loading: false,
    error,
  };
}

// ---------------------------------------------------------------------------
// Assign a clinic admin — creates a real Firebase Auth account + "profiles"
// doc. Runs on a throwaway secondary app instance so creating the new
// account doesn't sign the current super admin out of their own session.
// The new admin sets their own password via a reset email — nobody else,
// including the super admin who creates the account, ever knows it.
// ---------------------------------------------------------------------------

export async function assignClinicAdmin(u: {
  username: string;
  email: string;
  fullName: string;
  clinicId: number;
}): Promise<{ ok: boolean; error?: string }> {
  const username = u.username.trim().toLowerCase();
  const email = u.email.trim().toLowerCase();
  const fullName = u.fullName.trim();

  if (!username || !email || !fullName) {
    return { ok: false, error: "All fields required" };
  }

  const throwawayPassword =
    crypto.randomUUID() + crypto.randomUUID().toUpperCase();

  const secondary = initializeApp(
    firebaseConfig,
    `admin-creation-${Date.now()}`,
  );

  try {
    const cred = await createUserWithEmailAndPassword(
      getFbAuth(secondary),
      email,
      throwawayPassword,
    );

    // Admin has no separate staff record (doctors/nurses do) — clinicId
    // lives directly on the profile since an admin isn't a clinical
    // identity referenced anywhere else in the data.
    await setDoc(doc(db, "profiles", cred.user.uid), {
      username,
      role: "admin",
      fullName,
      email,
      clinicId: u.clinicId,
      createdAt: new Date().toISOString(),
      builtin: false,
    });

    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      console.error("Invite email failed to send:", err);
      // Account + profile are already created and valid — don't fail the
      // whole assignment just because the invite email had a hiccup.
    }

    logAction({
      clinicId: u.clinicId,
      actor_id: getUsername() || "system",
      action_type: "staff.create",
      description: `Created admin account "${username}" at clinicId ${u.clinicId}`,
    });

    return { ok: true };
  } catch (err: any) {
    if (err.code === "auth/email-already-in-use")
      return { ok: false, error: "That email is already in use" };
    if (err.code === "auth/invalid-email")
      return { ok: false, error: "Invalid email address" };
    if (err.code === "auth/operation-not-allowed")
      return {
        ok: false,
        error: "Email/Password sign-in is not enabled in Firebase",
      };
    console.error("assignClinicAdmin failed:", err.code, err.message);
    return {
      ok: false,
      error: `Could not create account (${err.code ?? err.message ?? "unknown"})`,
    };
  } finally {
    await deleteApp(secondary);
  }
}