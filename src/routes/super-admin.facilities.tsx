import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  listClinics,
  deleteClinicIfEmpty,
  type ClinicRecord,
} from "@/lib/clinic-data";
import { getUsers, removeUser } from "@/lib/auth";
import { assignClinicAdmin } from "@/lib/super-admin-service";
import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  ClipboardList,
  Trash2,
  ShieldCheck,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/super-admin/facilities")({
  component: SuperFacilities,
});

function SuperFacilities() {
  const queryClient = useQueryClient();
  const { data: clinics = [], isLoading } = useQuery({
    queryKey: ["clinics"],
    queryFn: listClinics,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: getUsers,
  });
  const [assign, setAssign] = useState<{
    open: boolean;
    clinic: ClinicRecord | null;
  }>({
    open: false,
    clinic: null,
  });
  const [search, setSearch] = useState("");

  const pending = clinics.filter((c) => c.status === "pending");
  const active = clinics.filter((c) => c.status === "active");

  // Matches on clinic name (partial, case-insensitive) or clinic ID
  // (partial string match, so typing "1" also surfaces 1, 14, 15 etc.,
  // same behaviour people expect from an ID search box).
  const q = search.trim().toLowerCase();
  const filteredActive = q
    ? active.filter(
        (c) =>
          c.clinicName.toLowerCase().includes(q) ||
          String(c.clinicId).includes(q),
      )
    : active;

  // Deleting anything here is a two-step, deliberate act: click the bin, then
  // confirm in a dialog. Removing a whole clinic also makes you type its name.
  const [clinicToRemove, setClinicToRemove] = useState<ClinicRecord | null>(
    null,
  );
  const [typedName, setTypedName] = useState("");
  const [adminToRemove, setAdminToRemove] = useState<{
    username: string;
    label: string;
    clinicName: string;
  } | null>(null);

  const remove = useMutation({
    mutationFn: (clinicId: number) => deleteClinicIfEmpty(clinicId),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error || "Could not remove");
        return;
      }
      toast.success("Clinic removed");
      setClinicToRemove(null);
      setTypedName("");
      queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Could not remove clinic",
      ),
  });

  const removeAdmin = useMutation({
    mutationFn: (username: string) => removeUser(username),
    onSuccess: () => {
      toast.success("Admin removed");
      setAdminToRemove(null);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err) => {
      setAdminToRemove(null);
      toast.error(
        err instanceof Error ? err.message : "Could not remove admin",
      );
    },
  });

  return (
    <AppShell role="super_admin" title="Facilities">
      {pending.length > 0 && (
        <Link
          to="/super-admin/applications"
          className="mb-6 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 transition hover:bg-amber-100/60"
        >
          <ClipboardList size={18} className="shrink-0 text-amber-800" />
          <p className="text-sm text-amber-900">
            <strong>{pending.length}</strong> clinic application
            {pending.length === 1 ? "" : "s"} waiting for review. Open Clinic
            Applications to check and approve them.
          </p>
        </Link>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center gap-3">
          <Building2 size={16} />
          <h3 className="font-semibold">Active clinics</h3>
          <div className="relative ml-4 flex-1 max-w-xs">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or clinic ID…"
              className="w-full border rounded-md pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {isLoading
              ? "Loading..."
              : q
                ? `${filteredActive.length} of ${active.length}`
                : `${active.length} live`}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-5 py-3 font-medium">Clinic</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Clinic ID</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {filteredActive.map((c) => {
              const admins = users.filter(
                (u) => u.role === "admin" && u.clinicId === c.clinicId,
              );
              return (
                <tr key={c.clinicId} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {c.clinicName}
                    <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                      {admins.length === 0 && <div>No admin assigned</div>}
                      {admins.map((a) => (
                        <div
                          key={a.username}
                          className="flex items-center gap-1.5"
                        >
                          <span>Admin: {a.fullName ?? a.username}</span>
                          {!a.builtin && (
                          <button
                            onClick={() =>
                              setAdminToRemove({
                                username: a.username,
                                label: a.fullName ?? a.username,
                                clinicName: c.clinicName,
                              })
                            }
                            className="text-destructive hover:bg-destructive/10 p-0.5 rounded"
                            aria-label={`Remove admin ${a.fullName ?? a.username}`}
                          >
                            <Trash2 size={11} />
                          </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 capitalize">{c.type}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {c.clinicId}
                  </td>
                  <td className="px-5 py-3 text-right space-x-1">
                    <button
                      onClick={() => setAssign({ open: true, clinic: c })}
                      className="text-xs border px-2 py-1 rounded hover:bg-secondary inline-flex items-center gap-1"
                    >
                      <ShieldCheck size={12} /> Assign Admin
                    </button>
                    <button
                      onClick={() => {
                        setTypedName("");
                        setClinicToRemove(c);
                      }}
                      disabled={remove.isPending}
                      className="text-destructive hover:bg-destructive/10 p-1.5 rounded inline-flex disabled:opacity-40"
                      aria-label="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && filteredActive.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-muted-foreground text-sm"
                >
                  {q
                    ? `No clinics match "${search}".`
                    : "No active clinics yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={adminToRemove !== null}
        destructive
        busy={removeAdmin.isPending}
        title={`Remove admin ${adminToRemove?.label ?? ""}?`}
        description={
          `This removes ${adminToRemove?.label ?? "this admin"}'s login for ${adminToRemove?.clinicName ?? "the clinic"}. ` +
          `The clinic and its data stay. You can assign a new admin afterwards.`
        }
        confirmLabel="Remove admin"
        onCancel={() => setAdminToRemove(null)}
        onConfirm={() => {
          if (adminToRemove) removeAdmin.mutate(adminToRemove.username);
        }}
      />

      <ConfirmDialog
        open={clinicToRemove !== null}
        destructive
        busy={remove.isPending}
        confirmDisabled={
          typedName.trim().toLowerCase() !==
          (clinicToRemove?.clinicName ?? "").trim().toLowerCase()
        }
        title={`Remove ${clinicToRemove?.clinicName ?? "this clinic"}?`}
        description={
          "This deletes the clinic. It only works if no staff are still assigned to it. " +
          "To confirm, type the clinic's name below."
        }
        confirmLabel="Remove clinic"
        onCancel={() => {
          setClinicToRemove(null);
          setTypedName("");
        }}
        onConfirm={() => {
          if (clinicToRemove) remove.mutate(clinicToRemove.clinicId);
        }}
      >
        <input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder={clinicToRemove?.clinicName ?? ""}
          className="w-full border rounded-md px-3 py-2 text-sm"
          aria-label="Type the clinic name to confirm"
        />
      </ConfirmDialog>

      {assign.open && assign.clinic && (
        <AssignAdmin
          clinic={assign.clinic}
          onClose={() => setAssign({ open: false, clinic: null })}
        />
      )}
    </AppShell>
  );
}

function AssignAdmin({
  clinic,
  onClose,
}: {
  clinic: ClinicRecord;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    email: "",
  });

  const assign = useMutation({
    mutationFn: () =>
      assignClinicAdmin({
        username: form.username,
        email: form.email,
        fullName: form.fullName,
        clinicId: clinic.clinicId,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error || "Could not assign");
        return;
      }
      toast.success(
        `Invited ${form.fullName} as Admin of ${clinic.clinicName} — they'll get an email to set their password.`,
      );
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onClose();
    },
    onError: () => toast.error("Could not assign clinic admin"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.username || !form.email) {
      toast.error("All fields required");
      return;
    }
    assign.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white border-l shadow-xl h-full overflow-y-auto p-6">
        <p className="text-[10px] tracking-wider text-muted-foreground">
          ASSIGN CLINIC ADMIN
        </p>
        <h2 className="font-semibold text-lg mt-1">{clinic.clinicName}</h2>
        <p className="text-xs text-muted-foreground mb-5 capitalize">
          {clinic.type} clinic
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name">
            <input
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Username">
            <input
              required
              value={form.username}
              onChange={(e) =>
                setForm({ ...form, username: e.target.value.toLowerCase() })
              }
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Email">
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
              placeholder="admin will set their password via this address"
            />
          </Field>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border py-2 rounded-md text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={assign.isPending}
              className="flex-1 bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-sm disabled:opacity-60"
            >
              {assign.isPending ? "Inviting…" : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
