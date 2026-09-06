import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  removeUser,
  useCurrentAdmin,
  createLoginForExistingStaff,
} from "@/lib/auth";
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
  UserPlus,
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
  const [creatingFor, setCreatingFor] = useState<ClinicStaffMember | null>(
    null,
  );

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

      {creatingFor && (
        <CreateLoginPanel
          staff={creatingFor}
          clinicId={admin?.clinicId ?? 0}
          onClose={() => setCreatingFor(null)}
          onDone={() => {
            setCreatingFor(null);
            queryClient.invalidateQueries({ queryKey: ["clinic-staff"] });
          }}
        />
      )}

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
                      <button
                        onClick={() => setCreatingFor(s)}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-md border bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 inline-flex items-center gap-1"
                      >
                        <UserPlus size={11} /> Create login
                      </button>
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
function CreateLoginPanel({
  staff,
  clinicId,
  onClose,
  onDone,
}: {
  staff: ClinicStaffMember;
  clinicId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  // Pre-filled from the existing record, so the admin doesn't retype a name
  // and accidentally create a second version of the same person.
  const [username, setUsername] = useState(
    staff.fullName
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 12),
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (staff.userId == null) {
      toast.error(
        "This staff record has no linked user id, so a login can't be attached to it.",
      );
      return;
    }
    setBusy(true);
    const res = await createLoginForExistingStaff({
      staffId: staff.staffId,
      role: staff.role,
      username: username.trim(),
      email: email.trim(),
      fullName: staff.fullName,
      userId: staff.userId,
      clinicId,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Could not create login");
      return;
    }
    toast.success(
      `Login created for ${staff.fullName} — a set-password email was sent to ${email}`,
    );
    onDone();
  };

  return (
    <div className="mb-4 bg-white rounded-xl border border-[oklch(0.55_0.18_245)] p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">Create a login for {staff.fullName}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Attaches to their existing record ({staff.staffId}), so their
            appointments and history stay with them. They'll set their own
            password by email — you never see it.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-secondary shrink-0"
        >
          Cancel
        </button>
      </div>

      <form
        onSubmit={submit}
        className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-3 items-end"
      >
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
            USERNAME
          </label>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
            EMAIL ADDRESS
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their.name@example.com"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create login"}
        </button>
      </form>
    </div>
  );
}
