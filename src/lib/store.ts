import { useEffect, useState } from "react";
import {
  appointments as seedAppointments,
  stock as seedStock,
  nurses,
  patients as seedPatients,
} from "./data";
import type { AppointmentStatus } from "@/components/AppShell";
import { CLINIC_IDS, splitByClinic, type ClinicId } from "./clinic";

// ---------- Reactive in-memory store (legacy — still used for pharmacy/stock) ----------
type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((f) => f());

export type Appointment = (typeof seedAppointments)[number];
export type StockItem = (typeof seedStock)[number];
export type Allocation = { med: string; nurses: Record<string, number | null> };
export type PendingDistribution = {
  id: string;
  med: string;
  units: number;
  clinic: ClinicId;
  from: string;
  createdAt: string;
};
export type NewPatient = {
  id: string; name: string; condition: string; lastVisit: string;
};

let _appointments: Appointment[] = seedAppointments.map((a) => ({ ...a }));
let _stock: StockItem[] = seedStock.map((s) => ({ ...s }));
let _clinicStock: Record<string, Record<ClinicId, number>> = Object.fromEntries(
  _stock.map((s) => [s.name, splitByClinic(s.units, s.name)]),
);
let _pending: PendingDistribution[] = [];
let _extraPatients: NewPatient[] = [];
let _allocations: Allocation[] = [
  { med: "TLD (Tenofovir/Lamivudine/Dolutegravir)", nurses: { Olorato: 180, Nobuhle: 150, Michelle: 82 } },
  { med: "Efavirenz 600mg", nurses: { Olorato: 30, Nobuhle: 40, Michelle: 14 } },
];

export const getAppointments = () => _appointments;
export const getStock = () => _stock;
export const getAllocations = () => _allocations;
export const getPending = () => _pending;
export const getExtraPatients = () => _extraPatients;
export const getAllPatients = () => [..._extraPatients, ...seedPatients];

export function unitsForClinic(med: string, clinic: ClinicId): number {
  return _clinicStock[med]?.[clinic] ?? 0;
}
export function stockForClinic(clinic: ClinicId): StockItem[] {
  return _stock.map((s) => ({ ...s, units: unitsForClinic(s.name, clinic) }));
}
export function pendingForClinic(clinic: ClinicId): PendingDistribution[] {
  return _pending.filter((p) => p.clinic === clinic);
}

export function dispenseFromClinic(med: string, clinic: ClinicId, qty = 1): boolean {
  const cur = unitsForClinic(med, clinic);
  if (qty <= 0 || cur < qty) return false;
  _clinicStock = { ..._clinicStock, [med]: { ..._clinicStock[med], [clinic]: cur - qty } };
  emit();
  return true;
}

export function queueDistribution(d: Omit<PendingDistribution, "id" | "createdAt">) {
  const entry: PendingDistribution = {
    ...d,
    id: `pd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  _pending = [entry, ..._pending];
  _stock = _stock.map((s) => (s.name === d.med ? { ...s, units: Math.max(0, s.units - d.units) } : s));
  emit();
  return entry;
}

export function confirmReceipt(id: string): boolean {
  const p = _pending.find((x) => x.id === id);
  if (!p) return false;
  const cur = unitsForClinic(p.med, p.clinic);
  _clinicStock = { ..._clinicStock, [p.med]: { ..._clinicStock[p.med], [p.clinic]: cur + p.units } };
  _pending = _pending.filter((x) => x.id !== id);
  emit();
  return true;
}

export function registerPatient(p: Omit<NewPatient, "id" | "lastVisit">) {
  const id = `P-${String(9000 + _extraPatients.length + 1).padStart(4, "0")}`;
  const rec: NewPatient = { ...p, id, lastVisit: new Date().toISOString().slice(0, 10) };
  _extraPatients = [rec, ..._extraPatients];
  emit();
  return rec;
}

export function setAppointmentStatus(time: string, patient: string, status: AppointmentStatus) {
  _appointments = _appointments.map((a) =>
    a.time === time && a.patient === patient ? { ...a, status } : a,
  );
  emit();
}

export function addAppointment(a: Appointment) {
  _appointments = [..._appointments, a].sort((x, y) => x.time.localeCompare(y.time));
  emit();
}

export function saveAllocation(med: string, alloc: Record<string, number | null>) {
  const total = Object.values(alloc).reduce<number>((s, v) => s + (v ?? 0), 0);
  _stock = _stock.map((s) => (s.name === med ? { ...s, units: Math.max(0, s.units - total) } : s));
  _allocations = [..._allocations.filter((a) => a.med !== med), { med, nurses: alloc }];
  emit();
}

export function addStock(med: string, units: number) {
  if (!Number.isFinite(units) || units <= 0) return;
  _stock = _stock.map((s) => (s.name === med ? { ...s, units: s.units + units } : s));
  emit();
}

function useStoreSnapshot<T>(read: () => T): T {
  const [v, setV] = useState(read);
  useEffect(() => {
    const f = () => setV(() => read());
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export const useAppointments = () => useStoreSnapshot(getAppointments);
export const useStock = () => useStoreSnapshot(getStock);
export const useAllocations = () => useStoreSnapshot(getAllocations);
export const usePending = () => useStoreSnapshot(getPending);
export const useAllPatients = () => useStoreSnapshot(getAllPatients);
export const useClinicStock = (clinic: import("./clinic").ClinicId) =>
  useStoreSnapshot(() => stockForClinic(clinic));

// ---------- Real-time clock (used by queue escalation timers) ----------
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------- Effective appointment statuses (legacy local logic) ----------
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const SLOT_MIN = 30;

// Deterministic pseudo-random per appointment so the "past outcome" is stable.
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

export function computeEffective(rows: Appointment[], now: Date): Appointment[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // At most one In-progress per doctor: the slot whose [start, start+30) contains now.
  const inProgress: Record<string, string> = {};
  for (const a of rows) {
    const s = toMin(a.time);
    if (nowMin >= s && nowMin < s + SLOT_MIN) {
      if (!inProgress[a.doctor]) inProgress[a.doctor] = a.time;
    }
  }
  return rows.map((a) => {
    if (a.status === "Complete" || a.status === "No-show") return a;
    const s = toMin(a.time);
    if (inProgress[a.doctor] === a.time) return { ...a, status: "In-progress" };
    if (nowMin >= s + SLOT_MIN) {
      // Past slot with no manual decision — reveal precalculated outcome (95% Complete / 5% No-show).
      const r = hash(`${a.time}|${a.patient}|${a.doctor}`);
      return { ...a, status: r < 0.95 ? "Complete" : "No-show" };
    }
    return a; // future slot — keep Incomplete (default)
  });
}

export function queueForNow(rows: Appointment[], now: Date) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // Appointments scheduled within the next 60 minutes (and not yet past)
  return rows
    .filter((a) => {
      const s = toMin(a.time);
      return s >= nowMin && s <= nowMin + 60 && a.status !== "Complete" && a.status !== "No-show";
    })
    .sort((x, y) => x.time.localeCompare(y.time));
}

/** Patients flagged "High Risk" — 2+ no-shows in the effective set. */
export function highRiskPatients(effective: Appointment[]): Set<string> {
  const counts = new Map<string, number>();
  for (const a of effective) {
    if (a.status === "No-show") counts.set(a.patient, (counts.get(a.patient) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([p]) => p));
}

/** Most-frequently-dispensed quantity for a medication, from allocations history. */
export function usualQuantityFor(med: string): number | null {
  const vals: number[] = [];
  for (const a of _allocations) {
    if (a.med !== med) continue;
    for (const n of Object.keys(a.nurses)) {
      const v = a.nurses[n];
      if (typeof v === "number" && v > 0) vals.push(v);
    }
  }
  if (vals.length === 0) return null;
  const freq = new Map<number, number>();
  for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = vals[0], bestN = 0;
  for (const [v, n] of freq) if (n > bestN) { bestN = n; best = v; }
  return best;
}

export { nurses };