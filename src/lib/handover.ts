import { useEffect, useState } from "react";
import { loadLS, saveLS } from "./offline";

export type HandoverEntry = {
  id: string;
  ts: number;
  shift: "Day" | "Night";
  nurse: string;
  patient?: string;
  note: string;
  synced: boolean;
};

export type ShiftRollup = {
  id: string;
  finalizedAt: number;
  shift: "Day" | "Night";
  nurse: string;
  entryCount: number;
  patientCount: number;
  summary: string;
  entries: HandoverEntry[];
};

const KEY = "zennith:handover:v1";
const ROLLUP_KEY = "zennith:handover:rollups:v1";

export function useHandover() {
  const [entries, setEntries] = useState<HandoverEntry[]>([]);
  useEffect(() => {
    setEntries(loadLS<HandoverEntry[]>(KEY, []));
    // Simulated live sync: refresh every 5s (stands in for Firestore onSnapshot).
    const id = setInterval(() => setEntries(loadLS<HandoverEntry[]>(KEY, [])), 5000);
    return () => clearInterval(id);
  }, []);

  const add = (e: Omit<HandoverEntry, "id" | "ts" | "synced">) => {
    const next: HandoverEntry = {
      ...e,
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      synced: typeof navigator !== "undefined" ? navigator.onLine : true,
    };
    const list = [next, ...loadLS<HandoverEntry[]>(KEY, [])];
    saveLS(KEY, list);
    setEntries(list);
  };

  const remove = (id: string) => {
    const list = loadLS<HandoverEntry[]>(KEY, []).filter((e) => e.id !== id);
    saveLS(KEY, list);
    setEntries(list);
  };

  const finalizeShift = (shift: "Day" | "Night", nurse: string) => {
    const all = loadLS<HandoverEntry[]>(KEY, []);
    const { entries: shiftEntries, patients } = summarizeShift(all, shift);
    if (shiftEntries.length === 0) return null;
    const rollup: ShiftRollup = {
      id: `r_${Date.now()}`,
      finalizedAt: Date.now(),
      shift,
      nurse,
      entryCount: shiftEntries.length,
      patientCount: patients,
      summary: shiftEntries.map((e) => `• ${e.patient ?? "General"}: ${e.note}`).join("\n"),
      entries: shiftEntries,
    };
    const rollups = [rollup, ...loadLS<ShiftRollup[]>(ROLLUP_KEY, [])];
    saveLS(ROLLUP_KEY, rollups);
    const remaining = all.filter((e) => !shiftEntries.find((se) => se.id === e.id));
    saveLS(KEY, remaining);
    setEntries(remaining);
    return rollup;
  };

  return { entries, add, remove, finalizeShift };
}

export function useRollups() {
  const [rollups, setRollups] = useState<ShiftRollup[]>([]);
  useEffect(() => {
    setRollups(loadLS<ShiftRollup[]>(ROLLUP_KEY, []));
    const id = setInterval(() => setRollups(loadLS<ShiftRollup[]>(ROLLUP_KEY, [])), 5000);
    return () => clearInterval(id);
  }, []);
  return rollups;
}

export function summarizeShift(entries: HandoverEntry[], shift: "Day" | "Night") {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const inShift = entries.filter((e) => {
    if (e.ts < startOfDay.getTime()) return false;
    const h = new Date(e.ts).getHours();
    return shift === "Day" ? h >= 7 && h < 19 : h >= 19 || h < 7;
  });
  const patients = new Set(inShift.map((e) => e.patient).filter(Boolean));
  return { count: inShift.length, patients: patients.size, entries: inShift };
}
