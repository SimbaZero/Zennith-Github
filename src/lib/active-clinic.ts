import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Real replacement for the old useActiveClinic() in src/lib/clinic.ts, which
// ran on a hardcoded 3-clinic list with string ids ("hillbrow", "orchards",
// "yeoville") that had no connection to the real `clinics` collection.
//
// Uses a SHARED module-level store (same pattern the old useActiveClinic()
// used), so every place this hook is mounted for the same role — the header
// switcher in AppShell, and any page below it — stays in sync automatically.
// Without this, switching clinic in one place wouldn't update the other.

export interface ClinicOption {
  clinicId: number;
  clinicName: string;
}

type ClinicRole = "doctor" | "pharmacist";

const KEY_PREFIX = "zennith_active_clinic_";
const listeners: Record<ClinicRole, Set<() => void>> = {
  doctor: new Set(),
  pharmacist: new Set(),
};
const activeIdByRole: Partial<Record<ClinicRole, number>> = {};

function readStored(role: ClinicRole): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_PREFIX + role);
  return raw ? Number(raw) : null;
}

function broadcastSet(role: ClinicRole, id: number) {
  activeIdByRole[role] = id;
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY_PREFIX + role, String(id));
  }
  listeners[role].forEach((f) => f());
}

export function useRealActiveClinic(
  clinicIds: number[] | undefined,
  role: ClinicRole,
): {
  activeClinicId: number | undefined;
  activeClinicName: string | undefined;
  options: ClinicOption[];
  setActiveClinicId: (id: number) => void;
  loading: boolean;
} {
  const [options, setOptions] = useState<ClinicOption[]>([]);
  const [activeId, setActiveId] = useState<number | undefined>(
    () => activeIdByRole[role],
  );
  const [loading, setLoading] = useState(true);

  const idsKey = clinicIds?.join(",") ?? "";

  useEffect(() => {
    const f = () => setActiveId(activeIdByRole[role]);
    listeners[role].add(f);
    return () => {
      listeners[role].delete(f);
    };
  }, [role]);

  useEffect(() => {
    let cancelled = false;

    if (!clinicIds || clinicIds.length === 0) {
      setOptions([]);
      setLoading(false);
      return;
    }

    async function load() {
      const results = await Promise.all(
        clinicIds!.map(async (id) => {
          const snap = await getDoc(doc(db, "clinics", String(id)));
          return {
            clinicId: id,
            clinicName: snap.exists()
              ? (snap.data().clinicName as string)
              : `Clinic ${id}`,
          };
        }),
      );
      if (cancelled) return;

      setOptions(results);

      const stored = readStored(role);
      const current = activeIdByRole[role];
      const valid =
        current != null && clinicIds!.includes(current)
          ? current
          : stored != null && clinicIds!.includes(stored)
            ? stored
            : clinicIds![0];

      if (activeIdByRole[role] !== valid) {
        broadcastSet(role, valid);
      } else {
        setActiveId(valid);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [idsKey, role, clinicIds]);

  return {
    activeClinicId: activeId,
    activeClinicName: options.find((o) => o.clinicId === activeId)?.clinicName,
    options,
    setActiveClinicId: (id: number) => broadcastSet(role, id),
    loading,
  };
}
