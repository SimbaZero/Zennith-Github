import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs } from "@/lib/audit";
import { useCurrentAdmin } from "@/lib/auth";
import { LogTable } from "./super-admin.audit";
import { useMemo, useState } from "react";
import { ShieldCheck, Search } from "lucide-react";

export const Route = createFileRoute("/admin/audit")({ component: AdminAudit });

function AdminAudit() {
  const { admin } = useCurrentAdmin();
  const [q, setQ] = useState("");
  // Scoped to this admin's own clinic only.
  const { rows: all, loading, error } = useLogs(admin?.clinicId ?? null);

  const clinicNames = useMemo(() => {
    const m = new Map<number, string>();
    if (admin?.clinicId != null && admin.clinicName)
      m.set(admin.clinicId, admin.clinicName);
    return m;
  }, [admin?.clinicId, admin?.clinicName]);

  const rows = useMemo(() => {
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter(
      (r) =>
        r.description.toLowerCase().includes(needle) ||
        r.actor_id.toLowerCase().includes(needle) ||
        r.action_type.toLowerCase().includes(needle),
    );
  }, [all, q]);

  return (
    <AppShell
      role="admin"
      title="Audit Logs"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center gap-3 flex-wrap">
          <ShieldCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
          <div>
            <h3 className="font-semibold">
              System events · {admin?.clinicName ?? "your clinic"}
            </h3>
            <p className="text-xs text-muted-foreground">
              You can only view events for your own clinic.
            </p>
          </div>
          <div className="relative ml-auto">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search events…"
              className="border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
            />
          </div>
          <span className="text-xs text-muted-foreground">
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
