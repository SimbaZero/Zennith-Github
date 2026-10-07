import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useClinicForecasts,
  useCurrentPharmacist,
  saveReorderThreshold,
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
  type MedForecast,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";
import { toast } from "sonner";

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
            // A <div>, not a <button>: the reorder-level input below has to be
            // clickable and typeable, and a form control inside a button is
            // invalid HTML — every click would navigate away mid-edit. The
            // "Manage in Deliveries" link at the foot keeps the navigation.
            <div
              key={f.name}
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
              <ReorderLevelField forecast={f} />
              <button
                onClick={() => navigate({ to: "/pharmacist/deliveries" })}
                className="text-[11px] text-[oklch(0.55_0.18_245)] mt-3 hover:underline"
              >
                Manage in Deliveries →
              </button>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

/**
 * The level at which this medication raises an automatic reorder request.
 *
 * Defaults to the COMPUTED reorder point when nobody has set one, so the box
 * opens on a figure derived from real usage rather than 0 — which would read
 * as "never reorder this" and quietly switch the whole feature off for every
 * medication at a new clinic.
 *
 * Saves on blur rather than behind a per-row Save button: there is one value
 * per card, and a button per card would put twelve of them on screen to no
 * purpose. Nothing is written unless the number actually changed.
 */
function ReorderLevelField({ forecast }: { forecast: MedForecast }) {
  const configured = forecast.reorderThreshold;
  const fallback = forecast.reorderPoint;
  // What is currently persisted (or the computed suggestion when nothing is).
  const savedValue = configured ?? fallback;

  // `null` means "not being edited" — the box then shows savedValue live.
  //
  // This is NOT seeded into useState from savedValue, which would be a real
  // bug: the computed reorder point starts at 0 and rises once usage history
  // loads, so a seeded box would still read 0 afterwards, and blurring it
  // would save 0 — silently switching auto-reorder off for that medication.
  // Holding the draft separately means the field tracks the live figure until
  // somebody actually types in it.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = draft ?? String(savedValue);

  const commit = async () => {
    if (!forecast.docId || draft === null) return;
    const next = Number(draft);
    if (!Number.isFinite(next) || next < 0) {
      setDraft(null); // put the box back rather than saving junk
      return;
    }
    const rounded = Math.floor(next);
    if (rounded === savedValue) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await saveReorderThreshold(forecast.docId, rounded);
      toast.success(`${forecast.name}: reorder level set to ${rounded} units`);
      // Back to tracking the saved value, which the live inventory
      // subscription is about to deliver.
      setDraft(null);
    } catch (err) {
      setDraft(null);
      toast.error(
        err instanceof Error ? err.message : "Could not save the reorder level",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!forecast.docId) return null;

  return (
    <div className="mt-3 pt-3 border-t">
      <label className="text-[10px] tracking-wider text-muted-foreground block mb-1">
        REORDER LEVEL
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={shown}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="w-24 border rounded px-2 py-1 text-sm disabled:opacity-50"
        />
        <span className="text-[11px] text-muted-foreground">
          {configured == null ? "suggested — not set yet" : "units"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Raises a reorder request when stock falls to this.
      </p>
    </div>
  );
}
