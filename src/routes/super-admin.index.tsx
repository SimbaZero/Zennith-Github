import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useFacilities } from "@/lib/facilities";
import { useLogs, seedLogsIfEmpty } from "@/lib/audit";
import { Building2, Activity, Users } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/super-admin/")({ component: SuperAdminDashboard });

function SuperAdminDashboard() {
  useEffect(() => { seedLogsIfEmpty(); }, []);
  const facilities = useFacilities();
  const logs = useLogs();
  const last24 = logs.filter((l) => Date.now() - new Date(l.timestamp).getTime() < 86_400_000).length;

  return (
    <AppShell role="super_admin" title="Platform Overview" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat icon={Building2} label="REGISTERED FACILITIES" value={String(facilities.length)} sub="hospitals, clinics & centres" />
        <Stat icon={Activity} label="EVENTS (24H)" value={String(last24)} sub="platform-wide audit trail" />
        <Stat icon={Users} label="PLATFORM HEALTH" value="Online" sub="All services healthy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Link to="/super-admin/facilities" className="bg-white rounded-xl border p-6 hover:shadow-md transition group">
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.55_0.18_245)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <Building2 size={22} />
          </div>
          <h3 className="font-semibold mb-1">Manage Facilities</h3>
          <p className="text-sm text-muted-foreground">Register hospitals & clinics, assign a Facility Admin, and oversee onboarding.</p>
        </Link>
        <Link to="/super-admin/audit" className="bg-white rounded-xl border p-6 hover:shadow-md transition group">
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.18_0.06_260)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <Activity size={22} />
          </div>
          <h3 className="font-semibold mb-1">Platform Audit Logs</h3>
          <p className="text-sm text-muted-foreground">All system events across every facility. Filter by facility to inspect one hospital.</p>
        </Link>
      </div>

      <div className="mt-6 bg-white rounded-xl border p-5">
        <p className="text-[10px] tracking-wider text-muted-foreground mb-1">SCOPE</p>
        <p className="text-sm text-muted-foreground">
          Super Admins oversee global facility onboarding and platform health. Day-to-day patient and staff management is handled
          by each facility's own Admin.
        </p>
      </div>
    </AppShell>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-muted-foreground" />
        <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
