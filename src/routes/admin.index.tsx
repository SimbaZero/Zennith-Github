import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { getCustomUsers, STAFF_ROLES } from "@/lib/auth";
import { useEffect, useState } from "react";
import { UserPlus, ShieldCheck, Users } from "lucide-react";

export const Route = createFileRoute("/admin/")({ component: AdminDashboard });

function AdminDashboard() {
  const [count, setCount] = useState(0);
  useEffect(() => { getCustomUsers().then((l) => setCount(l.length)).catch(() => {}); }, []);

  return (
    <AppShell role="admin" title="Admin Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="STAFF ACCOUNTS" value={String(count + 4)} sub="incl. demo accounts" />
        <Stat label="ROLES MANAGED" value={String(STAFF_ROLES.length)} sub="doctor · nurse · pharmacist · receptionist" />
        <Stat label="SYSTEM" value="Online" sub="All services healthy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Link to="/admin/users" className="bg-white rounded-xl border p-6 hover:shadow-md transition group">
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.55_0.18_245)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <UserPlus size={22} />
          </div>
          <h3 className="font-semibold mb-1">Create New User</h3>
          <p className="text-sm text-muted-foreground">Add doctors, nurses, pharmacists or receptionists to the system.</p>
        </Link>
        <Link to="/admin/staff" className="bg-white rounded-xl border p-6 hover:shadow-md transition group">
          <div className="w-12 h-12 rounded-lg bg-[oklch(0.18_0.06_260)] text-white flex items-center justify-center mb-4 group-hover:scale-110 transition">
            <ShieldCheck size={22} />
          </div>
          <h3 className="font-semibold mb-1">All Staff</h3>
          <p className="text-sm text-muted-foreground">View, manage and remove staff accounts.</p>
        </Link>
      </div>

      <div className="mt-6 bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-2"><Users size={16} /><h3 className="font-semibold">Note</h3></div>
        <p className="text-sm text-muted-foreground">Patients are <strong>not</strong> managed here — they self-register through the patient signup or via Reception.</p>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
