import { useEffect, useState } from "react";
import { appointments as seedAppointments, nurses } from "./data";
import type { AppointmentStatus } from "@/components/AppShell";

// ---------------------------------------------------------------------------
// LEGACY MOCK STORE — what's left of the original prototype.
//
// Everything here except useNow() runs on hardcoded demo data from ./data.ts,
// NOT on Firestore. The real equivalents now live in clinic-data.ts,
// nurse-service.ts, doctor-service.ts and pharmacist-service.ts.
//
// Still used only by the public landing page (src/routes/index.tsx), which
// shows an illustrative "live queue" to visitors who aren't signed in.
// TODO: point the landing page at the real queue collection, then this whole
// file can be deleted.
//
// The clinic-stock half of this file (splitByClinic, unitsForClinic,
// stockForClinic, dispenseFromClinic, useClinicStock, etc.) has been removed:
// nothing imported it, and it depended on the old hardcoded 3-clinic list.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((f) => f());

export type Appointment = (typeof seedAppointments)[number];

let _appointments: Appointment[] = seedAppointments.map((a) => ({ ...a }));

export const getAppointments = () => _appointments;

export function setAppointmentStatus(
  time: string,
  patient: string,
  status: AppointmentStatus,
) {
  _appointments = _appointments.map((a) =>
    a.time === time && a.patient === patient ? { ...a, status } : a,
  );
  emit();
}

export function addAppointment(a: Appointment) {
  _appointments = [..._appointments, a].sort((x, y) =>
    x.time.localeCompare(y.time),
  );
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

// ---------- Real-time clock (genuinely used, not mock) ----------
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------- Demo appointment statuses ----------
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

/**
 * DEMO ONLY. Past appointments are assigned Complete/No-show from a hash of
 * the patient name (95%/5%) — these outcomes never happened. Real appointment
 * statuses come from Firestore via clinic-data.ts. Used only by the public
 * landing page's illustrative queue.
 */
export function computeEffective(
  rows: Appointment[],
  now: Date,
): Appointment[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
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
      const r = hash(`${a.time}|${a.patient}|${a.doctor}`);
      return { ...a, status: r < 0.95 ? "Complete" : "No-show" };
    }
    return a;
  });
}

/** DEMO ONLY — see computeEffective above. */
export function queueForNow(rows: Appointment[], now: Date) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return rows
    .filter((a) => {
      const s = toMin(a.time);
      return (
        s >= nowMin &&
        s <= nowMin + 60 &&
        a.status !== "Complete" &&
        a.status !== "No-show"
      );
    })
    .sort((x, y) => x.time.localeCompare(y.time));
}

export { nurses };
