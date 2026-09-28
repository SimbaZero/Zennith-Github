import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  useClinicForecasts,
  useCurrentPharmacist,
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
  type MedForecast,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/pharmacist/stock")({ component: Stock });

// A full bar means at least this many days of cover left.
const FULL_BAR_DAYS = 30;

function Stock() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  const navigate = useNavigate();

  // Every figure on this page — average per day, reorder point, status —
  // comes from useClinicForecasts, the same hook Medication Overview uses,
  // scoped to the selected clinic. Don't compute usage or thresholds locally
  // here; that's how the two pages ended up disagreeing (this page used to
  // show a fake "Avg/day" of threshold/5).
  const { forecasts } = useClinicForecasts(realClinic.activeClinicId);

  const valueColor = (f: MedForecast) =>
    f.status === "critical" || f.onHand <= 0
      ? "text-[oklch(0.55_0.2_25)]"
      : f.status === "reorder"
        ? "text-[oklch(0.55_0.18_70)]"
        : f.status === "healthy"
          ? "text-[oklch(0.5_0.18_160)]"
          : "text-foreground";
  const barColor = (f: MedForecast) =>
    f.status === "critical"
      ? "bg-[oklch(0.6_0.2_25)]"
      : f.status === "reorder"
        ? "bg-[oklch(0.7_0.18_75)]"
        : f.status === "healthy"
          ? "bg-[oklch(0.65_0.18_160)]"
          : "bg-slate-300";

  return (
    <AppShell role="pharmacist" title="Stock Management">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {forecasts.length} medications at{" "}
            {realClinic.activeClinicName ?? "your clinic"} · live · updates from
            Deliveries
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/pharmacist/deliveries" })}
          className="bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
        >
          Go to Deliveries →
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {forecasts.map((f) => {
          const pct =
            f.daysRemaining == null
              ? 0
              : Math.min(100, (f.daysRemaining / FULL_BAR_DAYS) * 100);
          return (
            <button
              key={f.name}
              onClick={() => navigate({ to: "/pharmacist/deliveries" })}
              className="text-left bg-white rounded-xl border p-5 hover:border-[oklch(0.55_0.18_245)] hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] tracking-wider text-muted-foreground">
                  {f.category}
                </p>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap border ${FORECAST_STATUS_STYLE[f.status]}`}
                >
                  {FORECAST_STATUS_TEXT[f.status]}
                </span>
              </div>
              <h4 className="font-semibold text-sm mt-1 leading-tight">
                {f.name}
              </h4>
              <p className={`text-3xl font-bold mt-3 ${valueColor(f)}`}>
                {f.onHand}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  units
                </span>
              </p>
              <div className="h-1.5 bg-secondary rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-full ${barColor(f)} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>Reorder point: {f.reorderPoint || "—"}</span>
                <span>Avg/day: {f.avgDailyUse || "—"}</span>
              </div>
              {f.daysRemaining != null && (
                <p className="text-xs text-muted-foreground mt-1">
                  About {f.daysRemaining} days left
                </p>
              )}
              <p className="text-[11px] text-[oklch(0.55_0.18_245)] mt-3">
                Manage in Deliveries →
              </p>
            </button>
          );
        })}
      </div>
    </AppShell>
  );
}
