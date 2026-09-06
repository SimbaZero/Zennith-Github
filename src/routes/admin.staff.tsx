import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { removeUser, useCurrentAdmin } from "@/lib/auth";
import { fetchClinicStaff, type ClinicStaffMember } from "@/lib/clinic-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Trash2,
  Stethoscope,
  Syringe,
  Pill,
  ClipboardList,
  Search,
  KeyRound,
  MapPin,
} from "lucide-react";

export const Route = createFileRoute("/admin/staff")({ component: Staff });

type Role = ClinicStaffMember["role"];

const ROLE_ICON: Record<Role, any> = {
  doctor: Stethoscope,
  nurse: Syringe,
  pharmacist: Pill,
  receptionist: ClipboardList,
};

const ROLE_TONE: Record<Role, string> = {
  doctor: "oklch(0.55 0.18 245)",
  nurse: "oklch(0.55 0.18 160)",
  pharmacist: "oklch(0.55 0.2 25)",
  receptionist: "oklch(0.55 0.17 70)",
};

function Staff() {
  const queryClient = useQueryClient();
  const { admin } = useCurrentAdmin();

  // Reads the real doctors/nurses/... records, not just login profiles.
  // Previously this listed profiles only, so anyone without a login was
  // invisible — which is why a clinic full of doctors reported zero.
  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["clinic-staff", admin?.clinicId],
    queryFn: () => fetchClinicStaff(admin!.clinicId!),
    enabled: admin?.clinicId != null,
  });

  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [q, setQ] = useState("");

  const remove = useMutation({
    mutationFn: (username: string) => removeUser(username),
    onSuccess: (_, u) => {
      toast.success(`Login "${u}" removed`);
      queryClient.invalidateQueries({ queryKey: ["clinic-staff"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: () => toast.error("Could not remove account"),
  });

  const filtered = useMemo(
    () =>
      staff.filter((s) => {
        if (roleFilter !== "all" && s.role !== roleFilter) return false;
        if (!q.trim()) return true;
        const needle = q.toLowerCase();
        return (
          s.fullName.toLowerCase().includes(needle) ||
          s.staffId.toLowerCase().includes(needle) ||
          (s.username ?? "").toLowerCase().includes(needle)
        );
      }),
    [staff, roleFilter, q],
  );

  const counts = {
    doctor: staff.filter((s) => s.role === "doctor").length,
    nurse: staff.filter((s) => s.role === "nurse").length,
    pharmacist: staff.filter((s) => s.role === "pharmacist").length,
    receptionist: staff.filter((s) => s.role === "receptionist").length,
  };
  const noLogin = staff.filter((s) => !s.hasLogin).length;

  return (
    <AppShell
      role="admin"
      title="All Staff"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {(
          [
            ["doctor", "DOCTORS", counts.doctor],
            ["nurse", "NURSES", counts.nurse],
            ["pharmacist", "PHARMACISTS", counts.pharmacist],
            ["receptionist", "RECEPTIONISTS", counts.receptionist],
          ] as const
        ).map(([role, label, value]) => {
          const Icon = ROLE_ICON[role];
          return (
            <div
              key={role}
              className="bg-white rounded-xl border p-4 flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: `color-mix(in oklab, ${ROLE_TONE[role]} 12%, white)`,
                  color: ROLE_TONE[role],
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
        })}
      </div>

      {/* Staff without a login can't use the system at all — worth surfacing
          rather than leaving an admin to notice one at a time. */}
      {noLogin > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-2">
          <KeyRound size={15} className="text-amber-700 shrink-0" />
          <p className="text-sm text-amber-900">
            <strong>{noLogin}</strong> staff member{noLogin === 1 ? "" : "s"} at
            this clinic {noLogin === 1 ? "has" : "have"} no login yet — they
            can't sign in until you create one.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(
          ["all", "doctor", "nurse", "pharmacist", "receptionist"] as const
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
            {r === "all" ? "Everyone" : `${r}s`}
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
            placeholder="Search name, ID or username…"
            className="border rounded-md pl-9 pr-3 py-1.5 text-sm w-64"
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
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Staff ID</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Login</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.staffId}
                  className="border-b last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-5 py-3 font-medium">
                    {s.fullName}
                    {s.visiting && (
                      <span className="ml-2 text-[10px] text-muted-foreground inline-flex items-center gap-1">
                        <MapPin size={10} /> also works elsewhere
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {s.staffId}
                  </td>
                  <td className="px-5 py-3 capitalize">{s.role}</td>
                  <td className="px-5 py-3">
                    {s.hasLogin ? (
                      <span className="font-mono text-xs">{s.username}</span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200">
                        No login
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {s.hasLogin && s.username && (
                      <button
                        onClick={() => {
                          const ok = window.confirm(
                            `Remove ${s.fullName}'s login (${s.username})?\n\n` +
                              `This deletes their login and their ${s.role} record. ` +
                              `Past activity they recorded stays, but their name ` +
                              `will no longer resolve against it.\n\n` +
                              `This cannot be undone from here.`,
                          );
                          if (ok) remove.mutate(s.username!);
                        }}
                        className="text-destructive hover:bg-destructive/10 p-1.5 rounded"
                        aria-label="Remove login"
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
                    {q.trim()
                      ? "No staff match your search."
                      : "No staff recorded at this clinic yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
