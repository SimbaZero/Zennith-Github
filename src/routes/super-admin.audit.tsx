import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs, type SystemLog } from "@/lib/audit";
import { listClinics } from "@/lib/clinic-data";
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
