import { useEffect, useState } from "react";

export const CLINICS = [
  { id: "hillbrow", name: "Hillbrow CHC", area: "Hillbrow, Johannesburg" },
  { id: "orchards", name: "Orchards Clinic", area: "Orchards, Johannesburg" },
  { id: "yeoville", name: "Yeoville CHC", area: "Yeoville, Johannesburg" },
] as const;

export type ClinicId = (typeof CLINICS)[number]["id"];
export const CLINIC_IDS = CLINICS.map((c) => c.id) as readonly ClinicId[];
export const DEFAULT_CLINIC: ClinicId = "hillbrow";

const KEY = "zennith_active_clinic";
const listeners = new Set<() => void>();

export function getActiveClinicId(): ClinicId {
  if (typeof window === "undefined") return DEFAULT_CLINIC;
  const v = localStorage.getItem(KEY) as ClinicId | null;
  return v && CLINIC_IDS.includes(v) ? v : DEFAULT_CLINIC;
}
export function setActiveClinicId(id: ClinicId) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, id);
  listeners.forEach((f) => f());
}
export function clinicName(id: ClinicId) {
  return CLINICS.find((c) => c.id === id)?.name ?? id;
}
export function useActiveClinic() {
  const [id, setId] = useState<ClinicId>(DEFAULT_CLINIC);
  useEffect(() => {
    setId(getActiveClinicId());
    const f = () => setId(getActiveClinicId());
    listeners.add(f);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) f(); };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(f);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return {
    id,
    name: clinicName(id),
    setId: setActiveClinicId,
    all: CLINICS,
  };
}

/** Deterministic per-clinic split of a total quantity across clinics. */
export function splitByClinic(total: number, seedStr: string): Record<ClinicId, number> {
  const seed = [...seedStr].reduce((s, c) => s + c.charCodeAt(0), 0);
  const weights = CLINIC_IDS.map((_, i) => 1 + ((seed + i * 7) % 5) / 10);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const out = {} as Record<ClinicId, number>;
  let assigned = 0;
  CLINIC_IDS.forEach((c, i) => {
    const v = i === CLINIC_IDS.length - 1
      ? total - assigned
      : Math.round((total * weights[i]) / wsum);
    out[c] = Math.max(0, v);
    assigned += out[c];
  });
  return out;
}
