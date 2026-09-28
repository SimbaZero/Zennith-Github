import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  useClinicForecasts,
  useCurrentPharmacist,
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";
import { Boxes, Activity, Share2, LineChart } from "lucide-react";

export const Route = createFileRoute("/pharmacist/")({
  component: PharmacistDashboard,
});

function PharmacistDashboard() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  // Same hook the Stock and Medication Overview pages use, so "critical"
  // means the same thing everywhere: "Order now" (under ~3 days of stock at
  // the real dispensing rate). Already scoped to the selected clinic.
  const { stock: clinicStock, forecasts } = useClinicForecasts(
    realClinic.activeClinicId,
  );

  const total = clinicStock.reduce((sum, x) => sum + x.units, 0);
  // "Order now" (or out of stock) first, then "Reorder soon". Zero-unit items
  // have no usage history to forecast from, so they're pulled in explicitly.
  // No cap — the card scrolls instead.
  const isCritical = (f: (typeof forecasts)[number]) =>
    f.status === "critical" || f.onHand <= 0;
  const alerts = forecasts
    .filter((f) => isCritical(f) || f.status === "reorder")
    .sort((a, b) => Number(isCritical(b)) - Number(isCritical(a)));
  const criticalCount = alerts.filter(isCritical).length;
  const lowOut = alerts.length;

  return (
    <AppShell role="pharmacist" title="Pharmacy Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="TOTAL STOCK"
          value={total.toLocaleString()}
          sub={`${clinicStock.length} medications at ${realClinic.activeClinicName ?? "your clinic"}`}
        />
        <Stat
          label="LOW / OUT"
          value={String(lowOut)}
          sub={`${criticalCount} order now`}
          tone="danger"
        />
        {/* TODO(db): "DISTRIBUTED TODAY" is a hardcoded placeholder, not
            real data — nothing queries for this yet. Same for "THIS
            WEEK" below (Units dispensed / Stock updates / Low stock
            alerts). Flagging so it isn't mistaken for real — needs a
            real decision on what these should actually query. */}
        <Stat label="DISTRIBUTED TODAY" value="148" sub="units to nurses" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">
              Critical Stock Levels
              {alerts.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({alerts.length})
                </span>
              )}
            </h3>
            <Link
              to="/pharmacist/stock"
              className="text-sm text-[oklch(0.55_0.18_245)] hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">
                Nothing needs reordering at{" "}
                {realClinic.activeClinicName ?? "this clinic"} right now.
              </p>
            ) : (
              alerts.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between p-3 hover:bg-secondary/40 rounded-md"
                >
                  <div>
                    <div className="font-medium text-sm">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.onHand} units
                      {f.daysRemaining != null
                        ? ` · About ${f.daysRemaining} days left`
                        : " · No usage data"}
                      {f.reorderPoint > 0
                        ? ` · Reorder point: ${f.reorderPoint}`
                        : ""}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${FORECAST_STATUS_STYLE[isCritical(f) ? "critical" : f.status]}`}
                  >
                    {f.onHand <= 0
                      ? "Out of stock"
                      : FORECAST_STATUS_TEXT[isCritical(f) ? "critical" : f.status]}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/pharmacist/stock"
              className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]"
            >
              <Boxes size={16} /> Manage Stock
            </Link>
            <Link
              to="/pharmacist/diagnostics"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Activity size={16} /> View Diagnostics
            </Link>
            <Link
              to="/pharmacist/deliveries"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Share2 size={16} /> Send a Delivery
            </Link>
            <Link
              to="/pharmacist/analytics"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <LineChart size={16} /> Predictive Analytics
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
              THIS WEEK
            </p>
            {/* TODO(db): these three are hardcoded placeholders too — see
                note above. */}
            <Row label="Units dispensed" value="1,248" />
            <Row label="Stock updates" value="23" />
            <Row label="Low stock alerts" value="4" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "danger";
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-3xl font-bold mt-1 ${tone === "danger" ? "text-[oklch(0.55_0.2_25)]" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
