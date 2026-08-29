import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AppShell,
  StatusBadge,
  computeStockStatus,
} from "@/components/AppShell";
import {
  useInventory,
  useMedicationDispenseTrends,
  useCurrentPharmacist,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/pharmacist/analytics")({
  component: MedicationOverview,
});

// Real trend direction, computed from actual dispensing history (see
// useMedicationDispenseTrends) — no more fake/random data.
function trendDirection(vals: number[]): "Rising" | "Falling" | "Steady" {
  const first = vals[0],
    last = vals[vals.length - 1];
  const delta = (last - first) / Math.max(first, 1);
  if (delta > 0.08) return "Rising";
  if (delta < -0.08) return "Falling";
  return "Steady";
}

function Sparkline({ values }: { values: number[] }) {
  const w = 100,
    h = 28;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-24 h-7">
      <polyline
        fill="none"
        stroke="oklch(0.55 0.18 245)"
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}

function MedicationOverview() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  const { stock } = useInventory();
  const trends = useMedicationDispenseTrends();

  // Filtered to the clinic picked in the header. Items with no clinicId at
  // all (older/legacy data) are shown regardless, rather than vanishing.
  const clinicStock = useMemo(
    () =>
      realClinic.activeClinicId == null
        ? stock
        : stock.filter(
            (s) =>
              s.clinicId == null || s.clinicId === realClinic.activeClinicId,
          ),
    [stock, realClinic.activeClinicId],
  );

  const enriched = clinicStock.map((s) => {
    // Real dispensing history for this med, or 7 zeros if none recorded yet.
    const series = trends[s.name] ?? new Array(7).fill(0);
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
        <p className="text-xs text-muted-foreground">
          Showing stock at {realClinic.activeClinicName ?? "your clinic"} and
          real 7-day dispensing history.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="TOTAL UNITS"
          value={totalUnits.toLocaleString()}
          sub="This clinic's stock"
        />
        <Stat
          label="MEDICATIONS TRACKED"
          value={String(enriched.length)}
          sub="Current formulary"
        />
        <Stat
          label="NEEDS ATTENTION"
          value={String(lowOut)}
          sub="Low or out of stock"
        />
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold">Medication Stock &amp; Usage</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            7-day trend shown as a sparkline — real units dispensed per day,
            from actual distribution records.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Medication</th>
                <th className="px-5 py-3 font-medium">On hand</th>
                <th className="px-5 py-3 font-medium">7-day dispensing</th>
                <th className="px-5 py-3 font-medium">Direction</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((m) => (
                <tr key={m.name} className="border-t hover:bg-secondary/40">
                  <td className="px-5 py-3.5 font-medium">
                    {m.name}
                    <div className="text-[10px] tracking-wider text-muted-foreground">
                      {m.category}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 font-semibold">{m.units}</td>
                  <td className="px-5 py-3.5">
                    <Sparkline values={m.series} />
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        m.trend === "Rising"
                          ? "text-[oklch(0.45_0.15_160)] border-[oklch(0.8_0.1_160)]"
                          : m.trend === "Falling"
                            ? "text-[oklch(0.5_0.2_25)] border-[oklch(0.85_0.12_25)]"
                            : "text-muted-foreground"
                      }`}
                    >
                      {m.trend}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
