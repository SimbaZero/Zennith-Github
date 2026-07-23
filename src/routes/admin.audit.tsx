import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs, seedLogsIfEmpty } from "@/lib/audit";
import { getUserFacility } from "@/lib/auth";
import { facilityName } from "@/lib/facilities";
import { LogTable } from "./super-admin.audit";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin/audit")({ component: AdminAudit });

function AdminAudit() {
  useEffect(() => { seedLogsIfEmpty(); }, []);
  const [fid, setFid] = useState<string | null>(null);
  useEffect(() => { setFid(getUserFacility()); }, []);
  const rows = useLogs(fid ?? undefined);

  return (
    <AppShell role="admin" title="Audit Logs">
      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center gap-3">
          <ShieldCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
          <div className="flex-1">
            <h3 className="font-semibold">System events · {facilityName(fid)}</h3>
            <p className="text-xs text-muted-foreground">You can only view logs for your assigned facility.</p>
          </div>
          <span className="text-xs text-muted-foreground">{rows.length} entries</span>
        </div>
        <LogTable rows={rows} />
      </div>
    </AppShell>
  );
}
