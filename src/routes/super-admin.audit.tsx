import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs, type SystemLog } from "@/lib/audit";
import { listClinics, subscribeQueueAudit } from "@/lib/clinic-data";
import type { QueueAuditEvent } from "@/lib/clinic-data";
import { buildFlags, buildStats, type Flag } from "@/lib/audit-insights";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";

export const Route = createFileRoute("/super-admin/audit")({
  component: SuperAudit,
});

function SuperAudit() {
  const [clinicFilter, setClinicFilter] = useState<string>("__all__");
  const [q, setQ] = useState("");
  const { data: clinics = [] } = useQuery({
    queryKey: ["clinics"],
    queryFn: listClinics,
  });
  // Super Admin sees every clinic's events.
  const { rows: all, loading, error } = useLogs(undefined);

  // Queue events across ALL clinics. Super Admin previously saw only staff
  // account changes — so the role responsible for oversight had less
  // visibility than a single-clinic admin, who gets both plus flagged
  // problems. Passing no clinicId means every clinic.
  const [rawQueue, setRawQueue] = useState<QueueAuditEvent[]>([]);
  useEffect(() => {
    const unsub = subscribeQueueAudit(
      (events) => setRawQueue(events),
      () => setRawQueue([]),
      null,
      300,
    );
    return () => unsub();
  }, []);

  const flags = useMemo(() => buildFlags(rawQueue, all), [rawQueue, all]);
  const stats = useMemo(() => buildStats(rawQueue), [rawQueue]);

  const clinicNames = useMemo(() => {
    const m = new Map<number, string>();
    clinics.forEach((c) => m.set(c.clinicId, c.clinicName));
    return m;
  }, [clinics]);

  const rows = useMemo(() => {
    let out = all;
    if (clinicFilter === "__platform__")
      out = out.filter((r) => r.clinicId == null);
    else if (clinicFilter !== "__all__")
      out = out.filter((r) => r.clinicId === Number(clinicFilter));
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter(
        (r) =>
          r.description.toLowerCase().includes(needle) ||
          r.actor_id.toLowerCase().includes(needle) ||
          r.action_type.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [all, clinicFilter, q]);

  return (
    <AppShell role="super_admin" title="Platform Audit Logs">
      <PlatformInsights flags={flags} stats={stats} clinicNames={clinicNames} />

      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center gap-3 flex-wrap">
          <Filter size={16} />
          <h3 className="font-semibold">System events</h3>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search description, actor or action…"
              className="border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-72"
            />
          </div>
          <select
            value={clinicFilter}
            onChange={(e) => setClinicFilter(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="__all__">All clinics</option>
            <option value="__platform__">Platform-wide only</option>
            {clinics.map((c) => (
              <option key={c.clinicId} value={c.clinicId}>
                {c.clinicName}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">
            {loading ? "Loading…" : `${rows.length} entries`}
          </span>
        </div>
        {error ? (
          <div className="p-5 text-sm text-destructive">
            Couldn't load the audit log: {error}
            <p className="text-xs text-muted-foreground mt-2">
              If this mentions an index, open your browser console (F12) —
              Firebase prints a link that creates it in one click.
            </p>
          </div>
        ) : (
          <LogTable rows={rows} clinicNames={clinicNames} loading={loading} />
        )}
      </div>
    </AppShell>
  );
}

export function LogTable({
  rows,
  clinicNames,
  loading,
}: {
  rows: SystemLog[];
  clinicNames: Map<number, string>;
  loading?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="px-5 py-3 font-medium">When</th>
            <th className="px-5 py-3 font-medium">Clinic</th>
            <th className="px-5 py-3 font-medium">Actor</th>
            <th className="px-5 py-3 font-medium">Action</th>
            <th className="px-5 py-3 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                {new Date(r.timestamp).toLocaleString()}
              </td>
              <td className="px-5 py-3">
                {r.clinicId == null
                  ? "Platform-wide"
                  : (clinicNames.get(r.clinicId) ?? `Clinic ${r.clinicId}`)}
              </td>
              <td className="px-5 py-3 font-mono text-xs">{r.actor_id}</td>
              <td className="px-5 py-3">
                <span className="text-[11px] bg-secondary px-2 py-0.5 rounded-full font-mono">
                  {r.action_type}
                </span>
              </td>
              <td className="px-5 py-3">{r.description}</td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-5 py-10 text-center text-sm text-muted-foreground"
              >
                No events recorded yet. Actions like creating or removing staff
                will appear here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function PlatformInsights({
  flags,
  stats,
  clinicNames,
}: {
  flags: Flag[];
  stats: ReturnType<typeof buildStats>;
  clinicNames: Map<number, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const critical = flags.filter((f) => f.severity === "critical").length;

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Mini
          label="NEEDS ATTENTION"
          value={String(flags.length)}
          alert={critical > 0}
        />
        <Mini label="CLINICS" value={String(clinicNames.size)} />
        <Mini label="PATIENTS CALLED" value={String(stats.patientsCalled)} />
        <Mini label="QUEUE EVENTS" value={String(stats.totalEvents)} />
      </div>

      {flags.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-600" />
            <h3 className="font-semibold text-sm">
              Worth looking at — across all clinics
            </h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {flags.length} flagged
            </span>
          </div>
          <ul className="divide-y max-h-96 overflow-y-auto">
            {flags.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => setOpen(open === f.id ? null : f.id)}
                  className="w-full text-left px-5 py-3 hover:bg-secondary/40 flex items-start gap-3"
                >
                  <span
                    className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                      f.severity === "critical" ? "bg-red-600" : "bg-amber-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {f.detail}
                    </p>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`mt-1 shrink-0 text-muted-foreground transition ${
                      open === f.id ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {open === f.id && (
                  <div className="px-5 pb-4 pl-10">
                    <p className="text-[10px] tracking-wider text-muted-foreground mb-2">
                      WHAT HAPPENED
                    </p>
                    <ol className="border-l-2 pl-4 space-y-2">
                      {f.evidence.map((e, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono text-muted-foreground mr-2">
                            {new Date(e.when).toLocaleTimeString("en-ZA", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {e.text}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-4 ${alert ? "border-red-300 bg-red-50" : ""}`}
    >
      <p className="text-[10px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-2xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}
