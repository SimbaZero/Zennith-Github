import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs, seedLogsIfEmpty } from "@/lib/audit";
import { useFacilities, facilityName } from "@/lib/facilities";
import { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";

export const Route = createFileRoute("/super-admin/audit")({ component: SuperAudit });

function SuperAudit() {
  useEffect(() => { seedLogsIfEmpty(); }, []);
  const [facility, setFacility] = useState<string>("__all__");
  const facilities = useFacilities();
  const all = useLogs();
  const rows = useMemo(() => {
    if (facility === "__all__") return all;
    if (facility === "__platform__") return all.filter((r) => r.facility_id === null);
    return all.filter((r) => r.facility_id === facility);
  }, [all, facility]);

  return (
    <AppShell role="super_admin" title="Platform Audit Logs">
      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center gap-3 flex-wrap">
          <Filter size={16} />
          <h3 className="font-semibold flex-1">System events</h3>
          <select value={facility} onChange={(e) => setFacility(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="__all__">All facilities</option>
            <option value="__platform__">Platform-wide only</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">{rows.length} entries</span>
        </div>
        <LogTable rows={rows} />
      </div>
    </AppShell>
  );
}

export function LogTable({ rows }: { rows: import("@/lib/audit").SystemLog[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="px-5 py-3 font-medium">When</th>
            <th className="px-5 py-3 font-medium">Facility</th>
            <th className="px-5 py-3 font-medium">Actor</th>
            <th className="px-5 py-3 font-medium">Action</th>
            <th className="px-5 py-3 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
              <td className="px-5 py-3">{facilityName(r.facility_id)}</td>
              <td className="px-5 py-3 font-mono text-xs">{r.actor_id}</td>
              <td className="px-5 py-3"><span className="text-[11px] bg-secondary px-2 py-0.5 rounded-full font-mono">{r.action_type}</span></td>
              <td className="px-5 py-3">{r.description}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">No events for this scope yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
