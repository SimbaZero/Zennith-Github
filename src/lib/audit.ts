import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/firebase";

// Real Firestore-backed audit log. Replaces the previous localStorage
// version, which was invisible across devices, capped at 500 rows, and
// silently wiped when a user cleared site data — meaning it was not an
// audit trail in any meaningful sense.
//
// Matches the conventions of the existing real queueAudit collection.

export type SystemLog = {
  id: string;
  clinicId: number | null; // null = platform-wide event
  actor_id: string;
  action_type: string;
  description: string;
  timestamp: string; // ISO, derived from the Firestore server timestamp
};

const COLLECTION = "systemAudit";

/** Fire-and-forget: never blocks or breaks the action being logged. */
export function logAction(entry: {
  clinicId?: number | null;
  actor_id: string;
  action_type: string;
  description: string;
}) {
  addDoc(collection(db, COLLECTION), {
    clinicId: entry.clinicId ?? null,
    actor_id: entry.actor_id,
    action_type: entry.action_type,
    description: entry.description,
    timestamp: serverTimestamp(),
  }).catch((err) => {
    // An audit write failing must never take down the user's actual action.
    console.error("Audit log write failed:", err);
  });
}

function toIso(ts: Timestamp | null | undefined): string {
  try {
    return ts?.toDate?.().toISOString() ?? new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Live audit log.
 *  - clinicId: number  -> only that clinic's events (what an Admin sees)
 *  - clinicId: undefined -> everything, all clinics (what a Super Admin sees)
 */
export function useLogs(
  clinicId?: number | null,
  limitCount = 200,
): { rows: SystemLog[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const q =
      clinicId == null
        ? query(
            collection(db, COLLECTION),
            orderBy("timestamp", "desc"),
            limit(limitCount),
          )
        : query(
            collection(db, COLLECTION),
            where("clinicId", "==", clinicId),
            orderBy("timestamp", "desc"),
            limit(limitCount),
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              clinicId: data.clinicId ?? null,
              actor_id: data.actor_id ?? "unknown",
              action_type: data.action_type ?? "unknown",
              description: data.description ?? "",
              timestamp: toIso(data.timestamp),
            };
          }),
        );
        setLoading(false);
      },
      (err) => {
        // A missing Firestore composite index shows up here — the console
        // error from Firebase includes a direct link to create it.
        console.error("Audit log read failed:", err);
        setError(err.message ?? "Could not load audit log");
        setLoading(false);
      },
    );

    return () => unsub();
  }, [clinicId, limitCount]);

  return { rows, loading, error };
}
