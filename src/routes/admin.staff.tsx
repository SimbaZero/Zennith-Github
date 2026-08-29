import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  getUsers,
  removeUser,
  useCurrentAdmin,
  type StaffRole,
} from "@/lib/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Trash2,
  X,
  Stethoscope,
  Syringe,
  Pill,
  ClipboardList,
  Shield,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/admin/staff")({ component: Staff });

type StaffRow = {
  username: string;
  fullName: string;
  role: StaffRole | "admin";
  builtin: boolean;
  createdAt: string;
};

const ROLE_ICON: Record<StaffRow["role"], any> = {
  doctor: Stethoscope,
  nurse: Syringe,
  pharmacist: Pill,
  receptionist: ClipboardList,
  admin: Shield,
};

function Staff() {
  const queryClient = useQueryClient();
  const { admin } = useCurrentAdmin();
  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: getUsers,
  });
  const [roleFilter, setRoleFilter] = useState<StaffRow["role"] | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<StaffRow | null>(null);

  const remove = useMutation({
    mutationFn: (u: string) => removeUser(u),
    onSuccess: (_, u) => {
      toast.success(`Account "${u}" removed`);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: () => toast.error("Could not remove account"),
  });

  // Real staff at THIS admin's clinic only. Previously this list invented one
  // fake row per role, so it always looked populated even when the clinic had
  // no staff at all — that's why the dashboard count and this list disagreed.
  const allRows: StaffRow[] = useMemo(() => {
    if (admin?.clinicId == null) return [];
    return allUsers
      .filter(
        (u) =>
          u.clinicId === admin.clinicId &&
          u.role !== "super_admin" &&
          u.role !== "patient",
      )
      .map((u) => ({
        username: u.username,
        role: u.role as StaffRow["role"],
        fullName: u.fullName ?? u.username,
        builtin: !!u.builtin,
        createdAt: u.createdAt ?? "—",
      }));
  }, [allUsers, admin?.clinicId]);

  const filtered = allRows.filter((r) => {
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      r.fullName.toLowerCase().includes(needle) ||
      r.username.toLowerCase().includes(needle)
    );
  });

  const counts = {
    doctor: allRows.filter((r) => r.role === "doctor").length,
    nurse: allRows.filter((r) => r.role === "nurse").length,
    pharmacist: allRows.filter((r) => r.role === "pharmacist").length,
    receptionist: allRows.filter((r) => r.role === "receptionist").length,
  };

  return (
    <AppShell
      role="admin"
      title="All Staff"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MetricCard
          icon={Stethoscope}
          label="DOCTORS"
          value={counts.doctor}
          tone="oklch(0.55_0.18_245)"
        />
        <MetricCard
          icon={Syringe}
          label="NURSES"
          value={counts.nurse}
          tone="oklch(0.55_0.18_160)"
        />
        <MetricCard
          icon={Pill}
          label="PHARMACISTS"
          value={counts.pharmacist}
          tone="oklch(0.55_0.2_25)"
        />
        <MetricCard
          icon={ClipboardList}
          label="RECEPTIONISTS"
          value={counts.receptionist}
          tone="oklch(0.55_0.17_70)"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(
          [
            "all",
            "doctor",
            "nurse",
            "pharmacist",
            "receptionist",
            "admin",
          ] as const
        ).map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={`text-xs px-3 py-1.5 rounded-full border capitalize ${
              roleFilter === r
                ? "bg-[oklch(0.18_0.06_260)] text-white border-[oklch(0.18_0.06_260)]"
                : "bg-white hover:bg-secondary"
            }`}
          >
            {r === "all" ? "Show all" : `Only ${r}s`}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or username…"
            className="border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b flex items-center gap-2">
          <h2 className="font-semibold">Staff Directory</h2>
          <span className="text-xs text-muted-foreground ml-auto">
            {isLoading
              ? "Loading…"
              : `${filtered.length} at ${admin?.clinicName ?? "your clinic"}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Username</th>
                <th className="px-5 py-3 font-medium">Full name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.username + u.role}
                  className="border-b last:border-0 hover:bg-secondary/40 cursor-pointer"
                  onClick={() => setSelected(u)}
                >
                  <td className="px-5 py-3 font-mono">{u.username}</td>
                  <td className="px-5 py-3">{u.fullName}</td>
                  <td className="px-5 py-3 capitalize">{u.role}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {u.builtin
                      ? "Seeded"
                      : `Created ${u.createdAt.slice(0, 10)}`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!u.builtin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove.mutate(u.username);
                        }}
                        className="text-destructive hover:bg-destructive/10 p-1.5 rounded"
                        aria-label="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-muted-foreground text-sm"
                  >
                    {allRows.length === 0
                      ? "No staff accounts at this clinic yet — create one from Create User."
                      : "No staff match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <StaffDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </AppShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: `oklch(from ${tone} l c h / 0.12)`,
          color: `oklch(${tone})`,
        }}
      >
        <Icon size={18} />
      </div>
      <div>
        <p className="text-[10px] tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-bold leading-none mt-1">{value}</p>
      </div>
    </div>
  );
}

function StaffDrawer({ row, onClose }: { row: StaffRow; onClose: () => void }) {
  const Icon = ROLE_ICON[row.role];
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white border-l shadow-xl h-full overflow-y-auto flex flex-col">
        <div className="p-5 border-b flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[oklch(0.97_0.03_245)] flex items-center justify-center">
              <Icon size={22} className="text-[oklch(0.4_0.15_245)]" />
            </div>
            <div>
              <p className="font-semibold text-lg">{row.fullName}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {row.role} · @{row.username}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded-md"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section title="Account">
            <p className="text-sm capitalize">Role: {row.role}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {row.builtin
                ? "Seeded demo account"
                : `Created ${row.createdAt.slice(0, 10)}`}
            </p>
          </Section>

          {/* The previous version of this drawer showed shift times, tenure,
              qualifications and permission toggles — all invented from a hash
              of the username, none of it real, and none of that data exists
              anywhere in the database. Removed rather than left looking real.
              TODO(db): if you want these for real, they need actual fields on
              the staff records first — that's a schema decision, not a UI one. */}
          <Section title="Not tracked yet">
            <p className="text-xs text-muted-foreground">
              Shift patterns, tenure, qualifications and per-user permissions
              aren't stored in the database yet, so they aren't shown here.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="text-[10px] tracking-wider text-muted-foreground mb-1.5">
        {title.toUpperCase()}
      </p>
      {children}
    </section>
  );
}
