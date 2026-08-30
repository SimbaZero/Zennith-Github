import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { listClinics } from "@/lib/clinic-data";
import { useQuery } from "@tanstack/react-query";
import { useLogs } from "@/lib/audit";
import { Building2, Activity, Users } from "lucide-react";

export const Route = createFileRoute("/super-admin/")({
  component: SuperAdminDashboard,
});

function SuperAdminDashboard() {
  const { data: facilities = [] } = useQuery({
    queryKey: ["clinics"],
    queryFn: listClinics,
  });
  const { rows: logs } = useLogs(undefined);
  const last24 = logs.filter(
    (l) => Date.now() - new Date(l.timestamp).getTime() < 86_400_000,
  ).length;

  return (
    <AppShell role="super_admin" title="Platform Overview" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          icon={Building2}
          label="REGISTERED FACILITIES"
          value={String(facilities.length)}
          sub="hospitals, clinics & centres"
        />
        <Stat
          icon={Activity}
          label="EVENTS (24H)"
          value={String(last24)}
          sub="across all facilities"
        />
        <Stat
          icon={Users}
          label="AUDIT ENTRIES"
          value={String(logs.length)}
          sub="full platform history"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Link
          to="/super-admin/facilities"
          className="bg-white rounded-xl border p-6 hover:shadow-md transition group"
        >
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.55_0.18_245)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <Building2 size={22} />
          </div>
          <h3 className="font-semibold mb-1">Facilities</h3>
          <p className="text-sm text-muted-foreground">
            Review clinic applications, approve onboarding, and assign a
            Facility Admin.
          </p>
        </Link>
        <Link
          to="/super-admin/audit"
          className="bg-white rounded-xl border p-6 hover:shadow-md transition group"
        >
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.18_0.06_260)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <Activity size={22} />
          </div>
          <h3 className="font-semibold mb-1">Platform Audit Logs</h3>
          <p className="text-sm text-muted-foreground">
            Every recorded action across every clinic on the platform.
          </p>
        </Link>
      </div>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <p className="text-[11px] tracking-wider">{label}</p>
      </div>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
