import { useEffect, useState } from "react";

export type SystemLog = {
  id: string;
  facility_id: string | null;
  actor_id: string;
  action_type: string;
  description: string;
  timestamp: string; // ISO
};

const KEY = "zennith_system_logs";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function read(): SystemLog[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as SystemLog[];
  } catch {
    return [];
  }
}
function write(rows: SystemLog[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 500)));
  emit();
}

export function logAction(entry: Omit<SystemLog, "id" | "timestamp">) {
  const row: SystemLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  write([row, ...read()]);
  return row;
}

export function getLogs(facilityId?: string | null): SystemLog[] {
  const all = read();
  if (facilityId === undefined) return all;
  return all.filter((r) => r.facility_id === facilityId);
}

export function useLogs(facilityId?: string | null): SystemLog[] {
  const [rows, setRows] = useState<SystemLog[]>(() => getLogs(facilityId));
  useEffect(() => {
    const f = () => setRows(getLogs(facilityId));
    listeners.add(f);
    f();
    return () => {
      listeners.delete(f);
    };
  }, [facilityId]);
  return rows;
}

/** Seed a couple of demo entries so panels don't feel empty on first load. */
export function seedLogsIfEmpty() {
  if (typeof window === "undefined") return;
  if (read().length > 0) return;
  const base = Date.now();
  const seed: SystemLog[] = [
    { id: "log_seed_1", facility_id: "hillbrow", actor_id: "admin", action_type: "settings.update", description: "Queue window set to 07:00–20:00", timestamp: new Date(base - 3600_000).toISOString() },
    { id: "log_seed_2", facility_id: "orchards", actor_id: "admin", action_type: "staff.create", description: "Onboarded doctor \"gandi\"", timestamp: new Date(base - 7200_000).toISOString() },
    { id: "log_seed_3", facility_id: null, actor_id: "superadmin", action_type: "facility.register", description: "Registered Yeoville CHC", timestamp: new Date(base - 86_400_000).toISOString() },
  ];
  write(seed);
}
