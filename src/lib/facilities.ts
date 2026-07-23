import { useEffect, useState } from "react";
import { CLINICS } from "./clinic";
import { logAction } from "./audit";

export type Facility = {
  id: string;
  name: string;
  area: string;
  kind: "Public Hospital" | "Private Hospital" | "Clinic" | "Healthcare Centre";
  createdAt: string;
};

const KEY = "zennith_facilities";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

const SEED: Facility[] = CLINICS.map((c) => ({
  id: c.id,
  name: c.name,
  area: c.area,
  kind: "Clinic" as const,
  createdAt: "2026-01-01",
}));

function readCustom(): Facility[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Facility[];
  } catch {
    return [];
  }
}
function writeCustom(rows: Facility[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows));
  emit();
}

export function getFacilities(): Facility[] {
  return [...SEED, ...readCustom()];
}
export function facilityName(id: string | null | undefined): string {
  if (!id) return "Platform-wide";
  return getFacilities().find((f) => f.id === id)?.name ?? id;
}
export function registerFacility(f: Omit<Facility, "id" | "createdAt">, actor: string): Facility {
  const id = f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || `fac_${Date.now()}`;
  const rec: Facility = { ...f, id, createdAt: new Date().toISOString().slice(0, 10) };
  writeCustom([...readCustom(), rec]);
  logAction({
    facility_id: id,
    actor_id: actor,
    action_type: "facility.register",
    description: `Registered ${f.kind} "${f.name}" (${f.area})`,
  });
  return rec;
}
export function removeFacility(id: string, actor: string) {
  writeCustom(readCustom().filter((r) => r.id !== id));
  logAction({
    facility_id: id,
    actor_id: actor,
    action_type: "facility.remove",
    description: `Removed facility ${id}`,
  });
}

export function useFacilities(): Facility[] {
  const [v, setV] = useState<Facility[]>(() => getFacilities());
  useEffect(() => {
    const f = () => setV(getFacilities());
    listeners.add(f);
    f();
    return () => {
      listeners.delete(f);
    };
  }, []);
  return v;
}
