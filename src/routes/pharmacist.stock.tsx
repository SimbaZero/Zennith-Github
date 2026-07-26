import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AppShell,
  StatusBadge,
  computeStockStatus,
} from "@/components/AppShell";
import { useInventory } from "@/lib/pharmacist-service"; // real Firestore data now, not mock store
import { useActiveClinic, CLINICS, type ClinicId } from "@/lib/clinic";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/pharmacist/stock")({ component: Stock });

function Stock() {
  const clinic = useActiveClinic();
  // TODO(db): inventory is currently one shared central pool (see db-issues.md #2) —
  // the clinic selector below stays in the UI, but does not yet filter these numbers.
  const { stock: items } = useInventory();
  const navigate = useNavigate();

  const enriched = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        status: computeStockStatus(i.units, i.threshold),
      })),
    [items],
  );

  const valueColor = (status: "OK" | "Low" | "Out") =>
    status === "OK"
      ? "text-[oklch(0.5_0.18_160)]"
      : status === "Low"
        ? "text-[oklch(0.55_0.18_70)]"
        : "text-[oklch(0.55_0.2_25)]";
  const barColor = (status: "OK" | "Low" | "Out") =>
    status === "OK"
      ? "bg-[oklch(0.65_0.18_160)]"
      : status === "Low"
        ? "bg-[oklch(0.7_0.18_75)]"
        : "bg-[oklch(0.6_0.2_25)]";

  return (
    <AppShell role="pharmacist" title="Stock Management">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 bg-white">
            <Building2 size={14} className="text-muted-foreground" />
            <select
              value={clinic.id}
              onChange={(e) => clinic.setId(e.target.value as ClinicId)}
              className="bg-transparent outline-none text-sm font-medium"
            >
              {CLINICS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">
            {enriched.length} medications · live · updates from Distribution
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/pharmacist/distribution" })}
          className="bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
        >
          Go to Distribution →
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {enriched.map((s) => {
          const pct = Math.min(
            100,
            (s.units / Math.max(s.threshold * 2, 1)) * 100,
          );
          return (
            <button
              key={s.name}
              onClick={() => navigate({ to: "/pharmacist/distribution" })}
              className="text-left bg-white rounded-xl border p-5 hover:border-[oklch(0.55_0.18_245)] hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] tracking-wider text-muted-foreground">
                  {s.category}
                </p>
                <StatusBadge status={s.status} />
              </div>
              <h4 className="font-semibold text-sm mt-1 leading-tight">
                {s.name}
              </h4>
              <p className={`text-3xl font-bold mt-3 ${valueColor(s.status)}`}>
                {s.units}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  units
                </span>
              </p>
              <div className="h-1.5 bg-secondary rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-full ${barColor(s.status)} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>Threshold: {s.threshold}</span>
                <span>Avg/day: {s.avgDay}</span>
              </div>
              <p className="text-[11px] text-[oklch(0.55_0.18_245)] mt-3">
                Manage in Distribution →
              </p>
            </button>
          );
        })}
      </div>
    </AppShell>
  );
}
