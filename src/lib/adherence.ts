import { useEffect, useState } from "react";
import { loadLS, saveLS } from "./offline";

// Offline-first medication adherence for chronic care patients.
// Record shape: { [patientId]: { [YYYY-MM-DD]: { [med]: boolean } } }
type AdherenceMap = Record<string, Record<string, Record<string, boolean>>>;
const KEY = "zennith:adherence:v1";
const PENDING_KEY = "zennith:adherence:pending:v1";

export type PendingSync = { pid: string; date: string; med: string; taken: boolean; ts: number };

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useAdherence(pid: string) {
  const [map, setMap] = useState<AdherenceMap>({});
  useEffect(() => {
    setMap(loadLS<AdherenceMap>(KEY, {}));
  }, []);
  const dateKey = today();
  const forToday = map[pid]?.[dateKey] ?? {};

  const setTaken = (med: string, taken: boolean) => {
    const next: AdherenceMap = { ...map };
    next[pid] = { ...(next[pid] ?? {}) };
    next[pid][dateKey] = { ...(next[pid][dateKey] ?? {}), [med]: taken };
    setMap(next);
    saveLS(KEY, next);
    // queue for background sync
    const pending = loadLS<PendingSync[]>(PENDING_KEY, []);
    pending.push({ pid, date: dateKey, med, taken, ts: Date.now() });
    saveLS(PENDING_KEY, pending);
  };

  return { forToday, setTaken };
}

export function pendingSyncCount() {
  return loadLS<PendingSync[]>(PENDING_KEY, []).length;
}
export function drainPending() {
  saveLS<PendingSync[]>(PENDING_KEY, []);
}
