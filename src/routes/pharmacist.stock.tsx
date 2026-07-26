import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusBadge, computeStockStatus } from "@/components/AppShell";
import { fetchInventory } from "@/lib/clinic-data";

export const Route = createFileRoute("/pharmacist/stock")({ component: Stock });

function Stock() {
  const navigate = useNavigate();
  const { data: items, isLoading, isError } = useQuery({
    queryKey: ["inventory"],
    queryFn: fetchInventory,
  });

  const enriched = (items ?? []).map((i) => ({ ...i, status: computeStockStatus(i.units, i.threshold) }));

  const valueColor = (status: "OK" | "Low" | "Out") =>
    status === "OK" ? "text-[oklch(0.5_0.18_160)]" : status === "Low" ? "text-[oklch(0.55_0.18_70)]" : "text-[oklch(0.55_0.2_25)]";
  const barColor = (status: "OK" | "Low" | "Out") =>
    status === "OK" ? "bg-[oklch(0.65_0.18_160)]" : status === "Low" ? "bg-[oklch(0.7_0.18_75)]" : "bg-[oklch(0.6_0.2_25)]";

  return (
    <AppShell role="pharmacist" title="Stock Management">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading inventoryâ€¦" : `${enriched.length} medications Â· live Â· updates from Distribution`}
        </p>
        <button
          onClick={() => navigate({ to: "/pharmacist/distribution" })}
          className="bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
        >
          Go to Distribution â†’
        </button>
      </div>

      {isError && <p className="text-sm text-destructive">Could not load inventory.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {enriched.map((s) => {
          const pct = Math.min(100, (s.units / Math.max(s.threshold * 2, 1)) * 100);
          return (
            <button
              key={s.id}
              onClick={() => navigate({ to: "/pharmacist/distribution" })}
              className="text-left bg-white rounded-xl border p-5 hover:border-[oklch(0.55_0.18_245)] hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] tracking-wider text-muted-foreground">{s.category}</p>
                <StatusBadge status={s.status} />
              </div>
              <h4 className="font-semibold text-sm mt-1 leading-tight">{s.name}</h4>
              <p className={`text-3xl font-bold mt-3 ${valueColor(s.status)}`}>
                {s.units} <span className="text-sm font-normal text-muted-foreground">units</span>
              </p>
              <div className="h-1.5 bg-secondary rounded-full mt-3 overflow-hidden">
                <div className={`h-full ${barColor(s.status)} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>Threshold: {s.threshold}</span>
                <span>Updated: {s.lastUpdated ? s.lastUpdated.slice(0, 10) : "â€”"}</span>
              </div>
              <p className="text-[11px] text-[oklch(0.55_0.18_245)] mt-3">Manage in Distribution â†’</p>
            </button>
          );
        })}
      </div>
    </AppShell>
  );
}
