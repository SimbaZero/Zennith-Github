import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AppShell,
  StatusBadge,
  computeStockStatus,
} from "@/components/AppShell";
import { useInventory } from "@/lib/pharmacist-service";
import { Boxes, Activity, Share2, LineChart } from "lucide-react";

export const Route = createFileRoute("/pharmacist/")({
  component: PharmacistDashboard,
});

function PharmacistDashboard() {
  const { stock } = useInventory();

  const enriched = stock.map((s) => ({
    ...s,
    status: computeStockStatus(s.units, s.threshold),
  }));
  const total = enriched.reduce((s, x) => s + x.units, 0);
  const lowOut = enriched.filter((s) => s.status !== "OK").length;
  const critical = enriched.filter((s) => s.status !== "OK").slice(0, 4);

  return (
    <AppShell role="pharmacist" title="Pharmacy Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="TOTAL STOCK"
          value={total.toLocaleString()}
          sub={`${stock.length} medications`}
        />
        <Stat
          label="LOW / OUT"
          value={String(lowOut)}
          sub="Needs attention"
          tone="danger"
        />
        <Stat label="DISTRIBUTED TODAY" value="148" sub="units to nurses" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Critical Stock Levels</h3>
            <Link
              to="/pharmacist/stock"
              className="text-sm text-[oklch(0.55_0.18_245)] hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {critical.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between p-3 hover:bg-secondary/40 rounded-md"
              >
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.units} units · Threshold: {s.threshold}
                  </div>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
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
              to="/pharmacist/distribution"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Share2 size={16} /> Distribute to Nurses
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
