import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  useClinicForecasts,
  useCurrentPharmacist,
  useStockDeliveries,
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
  reorderSuggestions,
  useOpenReorders,
  type MedForecast,
} from "@/lib/pharmacist-service";
import { QuickReorderForm } from "@/components/QuickReorder";
import { useRestockSplit } from "@/lib/restock-split";
import { ClinicDeliveryDialog } from "@/components/ClinicDeliverySuggestions";
import { useMemo, useState } from "react";
import { Truck } from "lucide-react";
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
  // Medications that are running low and have no order in hand get a Quick
  // reorder right on their card; ones already ordered say so instead.
  const { openByInventoryDoc } = useOpenReorders(realClinic.activeClinicId);
  // A clinic's own line running low is topped up by SENDING the pharmacy's
  // stock to the clinic; only when nothing here can supply it is it ORDERED from
  // a supplier. Each low medicine gets one or the other, never both.
  const { deliveries } = useStockDeliveries(realClinic.activeClinicId);
  const onTheWay = useMemo(
    () =>
      deliveries
        .filter((d) => d.status === "Pending")
        .flatMap((d) => (d.items ?? []).map((i) => i.name)),
    [deliveries],
  );
  const { sendToClinic, sendDocIds, inTransitDocIds } = useRestockSplit(
    forecasts,
    realClinic.activeClinicId,
    onTheWay,
  );
  // The delivery dialog is opened right here, from the low card itself, with the
  // same suggestion the Deliveries page would offer.
  const [sending, setSending] = useState<string | null>(null);
  const suggestionFor = (docId: string | undefined) =>
    docId ? sendToClinic.find((s) => s.forecast.docId === docId) : undefined;
  const clinicNames = useMemo(
    () => new Map(realClinic.options.map((o) => [o.clinicId, o.clinicName])),
    [realClinic.options],
  );
  const suggested = new Set(
    reorderSuggestions(forecasts, openByInventoryDoc)
      .filter((f) => !f.docId || !sendDocIds.has(f.docId))
      .map((f) => f.docId),
  );

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
            What {realClinic.activeClinicName ?? "your clinic"} has on hand
            right now, for its own dispensing · {forecasts.length} medications ·
            live. The pharmacy's own stock is on Deliveries.
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
          // A low medicine the pharmacy can cover: clicking the card opens the
          // two-step "send to clinic" flow right here, pre-filled.
          const restock = suggestionFor(f.docId);
          return (
            // A <div>, not a <button>: it holds buttons of its own (Send to
            // clinic, Order from supplier, Manage in Deliveries), and a button
            // inside a button is invalid HTML. The card's click is a shortcut
            // to the same flow the inner button opens, which stays keyboard
            // reachable.
            <div
              key={f.name}
              data-testid="stock-card"
              data-restockable={restock ? "true" : undefined}
              onClick={restock ? () => setSending(f.docId ?? null) : undefined}
              className={`text-left bg-white rounded-xl border p-5 hover:border-[oklch(0.55_0.18_245)] hover:shadow-md transition ${
                restock ? "cursor-pointer" : ""
              }`}
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
              {f.docId && sendDocIds.has(f.docId) && (
                <div
                  className="mt-3 rounded-lg border border-[oklch(0.85_0.08_245)] bg-[oklch(0.97_0.03_245)] p-3"
                  data-testid="restock-from-pharmacy"
                >
                  <p className="mb-2 text-[11px] font-medium text-foreground">
                    {inTransitDocIds.has(f.docId)
                      ? "Low — a restock is on its way"
                      : "Low — the pharmacy can restock this clinic"}
                  </p>
                  {restock ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSending(f.docId ?? null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-xs text-white hover:bg-[oklch(0.25_0.08_260)]"
                    >
                      <Truck size={13} /> Send to clinic
                      <span className="opacity-70">
                        · suggested {restock.suggestedQty.toLocaleString()}
                      </span>
                    </button>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      A delivery from the pharmacy is already on its way.
                    </p>
                  )}
                </div>
              )}
              {f.docId && suggested.has(f.docId) && (
                <div
                  className={`mt-3 rounded-lg border p-3 ${
                    f.status === "critical"
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <p className="mb-2 text-[11px] font-medium text-foreground">
                    {f.status === "critical"
                      ? "Order now — nothing here can restock it"
                      : "Low — nothing here can restock it"}
                  </p>
                  <QuickReorderForm
                    forecast={f}
                    clinicId={realClinic.activeClinicId}
                    clinicName={realClinic.activeClinicName}
                  />
                </div>
              )}
              {f.docId && openByInventoryDoc.has(f.docId) && (
                <p className="mt-3 rounded-md bg-secondary px-3 py-1.5 text-[11px] text-muted-foreground">
                  {openByInventoryDoc.get(f.docId)?.kind === "pending"
                    ? "A reorder request is waiting for a decision (Medication Overview)."
                    : "Ordered — on its way. Stock goes up when you confirm it arrived, on Deliveries."}
                </p>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({ to: "/pharmacist/deliveries" });
                }}
                className="text-[11px] text-[oklch(0.55_0.18_245)] mt-3 hover:underline"
              >
                Manage in Deliveries →
              </button>
            </div>
          );
        })}
      </div>

      {/* The same two-step flow as the Suggested zone on Deliveries. */}
      {sendToClinic.map((sg) => (
        <ClinicDeliveryDialog
          key={sg.forecast.docId}
          open={sending === sg.forecast.docId}
          onClose={() => setSending(null)}
          suggestion={sg}
          clinicId={realClinic.activeClinicId!}
          clinicName={realClinic.activeClinicName}
          pharmacistId={pharmacist?.pharmacistId}
          clinicNames={clinicNames}
        />
      ))}
    </AppShell>
  );
}
