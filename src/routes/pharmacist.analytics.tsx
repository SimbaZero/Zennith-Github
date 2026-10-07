import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useClinicForecasts,
  summariseForecasts,
  useCurrentPharmacist,
  usePendingReorders,
  confirmReorder,
  dismissReorder,
  FORECAST_STATUS_STYLE as STATUS_STYLE,
  FORECAST_STATUS_TEXT as STATUS_TEXT,
  type ReorderRequest,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  TrendingDown,
  AlertTriangle,
  Package,
  Search,
  BellRing,
  Check,
  X,
} from "lucide-react";

export const Route = createFileRoute("/pharmacist/analytics")({
  component: MedicationOverview,
});

function MedicationOverview() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  // Same hook as the Stock page, so the two can't disagree — and scoped to
  // the selected clinic, usage included.
  const { forecasts } = useClinicForecasts(realClinic.activeClinicId);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = q.trim()
    ? forecasts.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
    : forecasts;

  const critical = forecasts.filter((f) => f.status === "critical");
  const reorder = forecasts.filter((f) => f.status === "reorder");

  // Total units dispensed per day across everything — the clinic's overall
  // consumption shape, which is what shows whether demand is rising.
  const totalDaily = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of forecasts) {
      for (const d of f.history) {
        map.set(d.date, (map.get(d.date) ?? 0) + d.units);
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, units]) => ({
        date: date.slice(5),
        units,
      }));
  }, [forecasts]);

  const active = selected
    ? forecasts.find((f) => f.name === selected)
    : forecasts[0];

  return (
    <AppShell role="pharmacist" title="Medication Overview">
      <p className="text-xs text-muted-foreground mb-4">
        Forecasts for {realClinic.activeClinicName ?? "your clinic"}, from real
        dispensing history over the last 30 days.
      </p>

      {/* Plain-English reading of the same numbers below, for anyone who
          doesn't want to interpret the charts themselves. */}
      <Summary
        summary={summariseForecasts(forecasts, realClinic.activeClinicName)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Stat
          label="ORDER NOW"
          value={String(critical.length)}
          sub="Runs out within lead time"
          alert={critical.length > 0}
        />
        <Stat
          label="REORDER SOON"
          value={String(reorder.length)}
          sub="At or below reorder point"
        />
        <Stat
          label="MEDICATIONS"
          value={String(forecasts.length)}
          sub="Currently stocked"
        />
        <Stat
          label="DISPENSED (30D)"
          value={String(totalDaily.reduce((s, d) => s + d.units, 0))}
          sub="Total units"
        />
      </div>

      {/* Threshold-triggered reorder requests. Kept ABOVE and separate from
          "Order these now" lower down: that panel is the live computed
          forecast and changes as the numbers do, while these are recorded
          events awaiting a decision. Collapsing the two would lose the
          distinction between "the maths says order this" and "stock crossed
          the line on this date and nobody has acted on it yet". */}
      <ReorderRequestsPanel clinicId={realClinic.activeClinicId} />

      {/* Overall consumption */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <h3 className="font-semibold mb-1">Total daily dispensing</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Units dispensed per day across all medications.
        </p>
        {totalDaily.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No dispensing recorded in the last 30 days.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={totalDaily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
              <YAxis tick={{ fontSize: 11 }} width={35} />
              <Tooltip />
              <Bar
                dataKey="units"
                fill="oklch(0.55 0.18 245)"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Forecast table */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-5 border-b flex items-center gap-3">
            <div>
              <h3 className="font-semibold">Stock forecast</h3>
              <p className="text-xs text-muted-foreground">
                Most urgent first. Click a row for its trend.
              </p>
            </div>
            <div className="relative ml-auto">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="border rounded-md pl-8 pr-2 py-1.5 text-xs w-40"
              />
            </div>
          </div>
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2.5 font-medium">Medication</th>
                  <th className="px-4 py-2.5 font-medium">On hand</th>
                  <th className="px-4 py-2.5 font-medium">Per day</th>
                  <th className="px-4 py-2.5 font-medium">Days left</th>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr
                    key={f.name}
                    onClick={() => setSelected(f.name)}
                    className={`border-b last:border-0 cursor-pointer hover:bg-secondary/40 ${
                      active?.name === f.name ? "bg-secondary/50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{f.name}</td>
                    <td className="px-4 py-3">{f.onHand}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {f.avgDailyUse || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {f.daysRemaining == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={
                            f.status === "critical"
                              ? "font-semibold text-red-700"
                              : ""
                          }
                        >
                          {f.daysRemaining}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {f.suggestedOrder > 0 ? (
                        <span className="font-medium">{f.suggestedOrder}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[f.status]}`}
                      >
                        {STATUS_TEXT[f.status]}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No medications match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail */}
        <div className="space-y-4">
          {active && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold">{active.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">
                30-day dispensing
              </p>
              {active.history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No dispensing history.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart
                    data={active.history.map((h) => ({
                      date: h.date.slice(5),
                      units: h.units,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      interval={6}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={28} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="units"
                      stroke="oklch(0.55 0.18 245)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}

              <dl className="mt-4 pt-4 border-t space-y-2 text-sm">
                <Row label="On hand" value={String(active.onHand)} />
                <Row
                  label="Average per day"
                  value={active.avgDailyUse ? String(active.avgDailyUse) : "—"}
                />
                <Row
                  label="Reorder point"
                  value={
                    active.reorderPoint ? String(active.reorderPoint) : "—"
                  }
                />
                <Row
                  label="Suggested order"
                  value={
                    active.suggestedOrder ? String(active.suggestedOrder) : "—"
                  }
                />
              </dl>
              <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
                Reorder point assumes a 3-day supplier lead time and a 4-day
                safety buffer. Suggested order covers 30 days.
              </p>
            </div>
          )}

          {critical.length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={15} className="text-red-600" />
                <h3 className="font-semibold text-sm">Order these now</h3>
              </div>
              <ul className="space-y-2">
                {critical.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{f.name}</span>
                    <span className="text-red-700 font-medium">
                      {f.daysRemaining}d left
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-5 ${alert ? "border-red-300 bg-red-50" : ""}`}
    >
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-3xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Summary({
  summary,
}: {
  summary: { headline: string; points: string[] };
}) {
  return (
    <div className="bg-white rounded-xl border p-5 mb-6">
      <div className="flex items-start gap-3">
        <TrendingDown
          size={18}
          className="text-[oklch(0.55_0.18_245)] mt-0.5 shrink-0"
        />
        <div>
          <p className="font-semibold">{summary.headline}</p>
          {summary.points.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {summary.points.map((p, i) => (
                <li
                  key={i}
                  className="text-sm text-muted-foreground flex gap-2"
                >
                  <span className="text-[oklch(0.55_0.18_245)]">·</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pending reorder requests raised automatically when stock crossed its
 * reorder level. Each one is either ordered (recorded, nothing added to
 * stock) or dismissed.
 */
function ReorderRequestsPanel({ clinicId }: { clinicId: number | undefined }) {
  const { reorders, loading } = usePendingReorders(clinicId);

  // Nothing pending is the normal, healthy state — an empty panel every day
  // would train people to ignore the space it sits in.
  if (loading || reorders.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-amber-300 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <BellRing size={16} className="text-amber-600" />
        <h3 className="font-semibold">Reorder requests</h3>
        <span className="text-xs text-muted-foreground ml-auto">
          {reorders.length} awaiting a decision
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Raised automatically when stock fell to its reorder level. Confirming
        records that you placed the order — it does not add stock. Stock goes up
        when it arrives, through Receive stock on the Deliveries page.
      </p>
      <ul className="divide-y">
        {reorders.map((r) => (
          <ReorderRow key={r.docId} reorder={r} />
        ))}
      </ul>
    </div>
  );
}

function ReorderRow({ reorder }: { reorder: ReorderRequest }) {
  const { pharmacist } = useCurrentPharmacist();
  // Editable before confirming — the suggested figure is a calculation, and
  // the pharmacist may know the supplier only sells in boxes of 50, or that
  // another order is already in transit. Same inline-number pattern as the
  // delivery confirmation flow.
  const [qty, setQty] = useState(String(reorder.suggestedQty));
  const [busy, setBusy] = useState(false);

  const actor =
    pharmacist?.fullName || pharmacist?.pharmacistId || "pharmacist";
  const n = Number(qty);
  const valid = Number.isInteger(n) && n > 0;

  const confirm = async () => {
    setBusy(true);
    try {
      await confirmReorder(reorder.docId, n, actor);
      toast.success(`Recorded: ${n} × ${reorder.medName} ordered`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not record the order",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await dismissReorder(reorder.docId, actor);
      toast.success(`${reorder.medName} reorder dismissed`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not dismiss the request",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{reorder.medName}</p>
        <p className="text-xs text-muted-foreground">
          {reorder.currentUnits} unit{reorder.currentUnits === 1 ? "" : "s"}{" "}
          left
          {reorder.triggeredAt
            ? ` · flagged ${new Date(reorder.triggeredAt).toLocaleDateString(
                "en-ZA",
                { day: "numeric", month: "short" },
              )}`
            : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-[11px] text-muted-foreground">Order</label>
        <input
          type="number"
          min={1}
          value={qty}
          disabled={busy}
          onChange={(e) => setQty(e.target.value)}
          className={`w-20 border rounded px-2 py-1 text-sm disabled:opacity-50 ${
            !valid ? "border-red-400 bg-red-50" : ""
          }`}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={confirm}
          disabled={busy || !valid}
          className="inline-flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white text-xs px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
        >
          <Check size={13} /> Confirm
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 border text-xs px-3 py-1.5 rounded-md hover:bg-secondary disabled:opacity-50"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </li>
  );
}
