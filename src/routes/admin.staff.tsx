import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { getCustomUsers, removeUser, STAFF_ROLES, type StaffRole } from "@/lib/auth";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2, X, Stethoscope, Syringe, Pill, ClipboardList, Shield } from "lucide-react";

export const Route = createFileRoute("/admin/staff")({ component: Staff });

type StaffRow = {
  username: string;
  fullName: string;
  role: StaffRole | "admin";
  builtin: boolean;
  createdAt: string;
};

// Deterministic demo attributes so the drawer feels realistic.
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function shiftFor(u: string) {
  const shifts = [
    { label: "Day (07:00–15:00)", days: "Mon–Fri" },
    { label: "Late (13:00–21:00)", days: "Mon–Sat" },
    { label: "Night (21:00–07:00)", days: "Wed–Sun" },
    { label: "Split (09:00–13:00 · 17:00–21:00)", days: "Tue–Sat" },
  ];
  return shifts[hash(u) % shifts.length];
}
function tenureFor(u: string) {
  const years = 1 + (hash(u) % 12);
  const months = hash(u + "m") % 12;
  return `${years}y ${months}m`;
}
function qualificationsFor(role: StaffRow["role"]) {
  return {
    doctor: ["MBChB (Wits)", "Dip HIV Man (SA)"],
    nurse: ["Dip Nursing", "PHC certificate"],
    pharmacist: ["BPharm", "SAPC registered"],
    receptionist: ["Grade 12", "Medical admin cert."],
    admin: ["BCom / BA", "IT admin cert."],
  }[role];
}
function defaultPermsFor(role: StaffRow["role"]) {
  const all = ["Read patients", "Edit patients", "Dispense meds", "Manage stock", "Manage staff", "View audit log"];
  const map: Record<string, string[]> = {
    doctor: ["Read patients", "Edit patients", "Dispense meds", "View audit log"],
    nurse: ["Read patients", "Edit patients", "Dispense meds"],
    pharmacist: ["Read patients", "Manage stock"],
    receptionist: ["Read patients", "Edit patients"],
    admin: all,
  };
  return { granted: new Set(map[role]), all };
}
const ROLE_ICON: Record<StaffRow["role"], any> = { doctor: Stethoscope, nurse: Syringe, pharmacist: Pill, receptionist: ClipboardList, admin: Shield };

function Staff() {
  const [users, setUsers] = useState(() => getCustomUsers());
  const [roleFilter, setRoleFilter] = useState<StaffRow["role"] | "all">("all");
  const [selected, setSelected] = useState<StaffRow | null>(null);
  useEffect(() => { setUsers(getCustomUsers()); }, []);

  const del = (u: string) => {
    removeUser(u);
    setUsers(getCustomUsers());
    toast.success(`Account "${u}" removed`);
  };

  const allRows: StaffRow[] = useMemo(() => {
    const builtIns: StaffRow[] = STAFF_ROLES.map((r) => ({
      username: r, role: r, fullName: r[0].toUpperCase() + r.slice(1),
      builtin: true, createdAt: "2026-01-01",
    }));
    const admins: StaffRow[] = [{ username: "admin", role: "admin", fullName: "Admin", builtin: true, createdAt: "2026-01-01" }];
    const custom: StaffRow[] = users.map((u) => ({
      username: u.username, role: u.role as StaffRow["role"],
      fullName: u.fullName ?? u.username, builtin: false, createdAt: u.createdAt,
    }));
    return [...builtIns, ...admins, ...custom];
  }, [users]);

  const filtered = allRows.filter((r) => roleFilter === "all" || r.role === roleFilter);
  const counts = {
    doctor: allRows.filter((r) => r.role === "doctor").length,
    nurse: allRows.filter((r) => r.role === "nurse").length,
    pharmacist: allRows.filter((r) => r.role === "pharmacist").length,
    receptionist: allRows.filter((r) => r.role === "receptionist").length,
  };

  return (
    <AppShell role="admin" title="All Staff">
      {/* Metrics banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MetricCard icon={Stethoscope} label="DOCTORS" value={counts.doctor} tone="oklch(0.55_0.18_245)" />
        <MetricCard icon={Syringe} label="NURSES" value={counts.nurse} tone="oklch(0.55_0.18_160)" />
        <MetricCard icon={Pill} label="PHARMACISTS" value={counts.pharmacist} tone="oklch(0.55_0.2_25)" />
        <MetricCard icon={ClipboardList} label="RECEPTIONISTS" value={counts.receptionist} tone="oklch(0.55_0.17_70)" />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "doctor", "nurse", "pharmacist", "receptionist", "admin"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={`text-xs px-3 py-1.5 rounded-full border capitalize ${roleFilter === r ? "bg-[oklch(0.18_0.06_260)] text-white border-[oklch(0.18_0.06_260)]" : "bg-white hover:bg-secondary"}`}
          >
            {r === "all" ? "Show all" : `Only ${r}s`}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b"><h2 className="font-semibold">Staff Directory</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Username</th>
                <th className="px-5 py-3 font-medium">Full name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.username + u.role} className="border-b last:border-0 hover:bg-secondary/40 cursor-pointer"
                    onClick={() => setSelected(u)}>
                  <td className="px-5 py-3 font-mono">{u.username}</td>
                  <td className="px-5 py-3">{u.fullName}</td>
                  <td className="px-5 py-3 capitalize">{u.role}</td>
                  <td className="px-5 py-3 text-muted-foreground">{u.builtin ? "Demo" : `Created ${u.createdAt}`}</td>
                  <td className="px-5 py-3 text-right">
                    {!u.builtin && (
                      <button onClick={(e) => { e.stopPropagation(); del(u.username); }} className="text-destructive hover:bg-destructive/10 p-1.5 rounded" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">No matching staff.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <StaffDrawer row={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}

function MetricCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `oklch(from ${tone} l c h / 0.12)`, color: `oklch(${tone})` }}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[10px] tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xl font-bold leading-none mt-1">{value}</p>
      </div>
    </div>
  );
}

function StaffDrawer({ row, onClose }: { row: StaffRow; onClose: () => void }) {
  const Icon = ROLE_ICON[row.role];
  const shift = shiftFor(row.username);
  const tenure = tenureFor(row.username);
  const quals = qualificationsFor(row.role);
  const [perms, setPerms] = useState<{ granted: Set<string>; all: string[] }>(() => defaultPermsFor(row.role));

  const toggle = (p: string) => {
    const next = new Set(perms.granted);
    if (next.has(p)) next.delete(p); else next.add(p);
    setPerms({ ...perms, granted: next });
  };
  const save = () => {
    // In-app persistence: store per-username permission grants
    if (typeof window !== "undefined") {
      const key = "zennith_staff_perms";
      const store = JSON.parse(localStorage.getItem(key) || "{}");
      store[row.username] = [...perms.granted];
      localStorage.setItem(key, JSON.stringify(store));
    }
    toast.success(`Permissions updated for ${row.fullName}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white border-l shadow-xl h-full overflow-y-auto animate-in slide-in-from-right">
        <div className="p-5 border-b flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[oklch(0.97_0.03_245)] flex items-center justify-center">
              <Icon size={22} className="text-[oklch(0.4_0.15_245)]" />
            </div>
            <div>
              <p className="font-semibold text-lg">{row.fullName}</p>
              <p className="text-xs text-muted-foreground capitalize">{row.role} · @{row.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-md"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          <Section title="Working hours / shift">
            <p className="text-sm">{shift.label}</p>
            <p className="text-xs text-muted-foreground">{shift.days}</p>
          </Section>
          <Section title="Employment">
            <p className="text-sm">Tenure: <span className="font-semibold">{tenure}</span></p>
            <p className="text-xs text-muted-foreground">Joined {row.createdAt}</p>
          </Section>
          <Section title="Qualifications">
            <ul className="text-sm space-y-1">
              {quals.map((q) => <li key={q}>• {q}</li>)}
            </ul>
          </Section>
          <Section title="System access & permissions">
            <div className="space-y-2">
              {perms.all.map((p) => {
                const on = perms.granted.has(p);
                return (
                  <label key={p} className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm">{p}</span>
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      className={`w-10 h-5.5 rounded-full border relative transition-colors ${on ? "bg-[oklch(0.55_0.18_245)] border-[oklch(0.55_0.18_245)]" : "bg-secondary"}`}
                      style={{ height: 22 }}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-all ${on ? "left-5" : "left-0.5"}`} />
                    </button>
                  </label>
                );
              })}
            </div>
          </Section>
          <button onClick={save} className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]">
            Save permissions
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] tracking-wider text-muted-foreground mb-1.5">{title.toUpperCase()}</p>
      {children}
    </section>
  );
}
