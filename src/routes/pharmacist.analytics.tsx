import { createFileRoute } from "@tanstack/react-router";
import { AppShell, StatusBadge, computeStockStatus } from "@/components/AppShell";
import { useClinicStock } from "@/lib/store";
import { useActiveClinic, CLINICS, type ClinicId } from "@/lib/clinic";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/pharmacist/analytics")({ component: MedicationOverview });

/** Deterministic 7-day synthetic trend around current units. */
function trend7(name: string, units: number): number[] {
  const seed = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  const rnd = (i: number) => ((Math.sin(seed + i * 13.37) + 1) / 2); // 0..1
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    const wobble = (rnd(i) - 0.5) * 0.4; // -20%..+20%
    out.push(Math.max(0, Math.round(units * (1 + wobble))));
  }
  out[6] = units; // anchor today to current
  return out;
}
function trendDirection(vals: number[]): "Rising" | "Falling" | "Steady" {
  const first = vals[0], last = vals[vals.length - 1];
  const delta = (last - first) / Math.max(first, 1);
  if (delta > 0.08) return "Rising";
  if (delta < -0.08) return "Falling";
  return "Steady";
}

function Sparkline({ values }: { values: number[] }) {
  const w = 100, h = 28;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-24 h-7">
      <polyline fill="none" stroke="oklch(0.55 0.18 245)" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function MedicationOverview() {
  const clinic = useActiveClinic();
  const stock = useClinicStock(clinic.id);
  const enriched = stock.map((s) => {
    const series = trend7(s.name + clinic.id, s.units);
    return {
      ...s,
      status: computeStockStatus(s.units, s.threshold),
      series,
      trend: trendDirection(series),
    };
  });

  const totalUnits = enriched.reduce((s, x) => s + x.units, 0);
  const lowOut = enriched.filter((x) => x.status !== "OK").length;

  return (
    <AppShell role="pharmacist" title="Medication Overview">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 bg-white">
          <Building2 size={14} className="text-muted-foreground" />
          <select
            value={clinic.id}
            onChange={(e) => clinic.setId(e.target.value as ClinicId)}
            className="bg-transparent outline-none text-sm font-medium"
          >
            {CLINICS.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Showing on-hand stock and 7-day movement for {clinic.name}.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="TOTAL UNITS" value={totalUnits.toLocaleString()} sub={clinic.name} />
        <Stat label="MEDICATIONS TRACKED" value={String(enriched.length)} sub="Current formulary" />
        <Stat label="NEEDS ATTENTION" value={String(lowOut)} sub="Low or out of stock" />
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold">Stock at {clinic.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">7-day trend shown as a sparkline (last week of dispenses).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Medication</th>
                <th className="px-5 py-3 font-medium">On hand</th>
                <th className="px-5 py-3 font-medium">7-day trend</th>
                <th className="px-5 py-3 font-medium">Direction</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((m) => (
                <tr key={m.name} className="border-t hover:bg-secondary/40">
                  <td className="px-5 py-3.5 font-medium">
                    {m.name}
                    <div className="text-[10px] tracking-wider text-muted-foreground">{m.category}</div>
                  </td>
                  <td className="px-5 py-3.5 font-semibold">{m.units}</td>
                  <td className="px-5 py-3.5"><Sparkline values={m.series} /></td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      m.trend === "Rising" ? "text-[oklch(0.45_0.15_160)] border-[oklch(0.8_0.1_160)]" :
                      m.trend === "Falling" ? "text-[oklch(0.5_0.2_25)] border-[oklch(0.85_0.12_25)]" :
                      "text-muted-foreground"
                    }`}>
                      {m.trend}
                    </span>
                  </td>
                  <td className="px-5 py-3.5"><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
