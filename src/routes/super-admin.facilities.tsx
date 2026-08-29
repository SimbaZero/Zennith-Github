import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  listClinics,
  approveClinic,
  rejectClinicApplication,
  deleteClinicIfEmpty,
  type ClinicRecord,
} from "@/lib/clinic-data";
import { addUser, getUsers } from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Check, X, Trash2, ShieldCheck, Clock } from "lucide-react";

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

  const pending = clinics.filter((c) => c.status === "pending");
  const active = clinics.filter((c) => c.status === "active");

  const approve = useMutation({
    mutationFn: (clinicId: number) => approveClinic(clinicId),
    onSuccess: () => {
      toast.success("Clinic approved — now live");
      queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
    onError: () => toast.error("Could not approve"),
  });

  const reject = useMutation({
    mutationFn: (clinicId: number) => rejectClinicApplication(clinicId),
    onSuccess: () => {
      toast.success("Application rejected");
      queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
    onError: () => toast.error("Could not reject"),
  });

  const remove = useMutation({
    mutationFn: (clinicId: number) => deleteClinicIfEmpty(clinicId),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error || "Could not remove");
        return;
      }
      toast.success("Clinic removed");
      queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
    onError: () => toast.error("Could not remove clinic"),
  });

  return (
    <AppShell role="super_admin" title="Facilities">
      {pending.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden mb-6">
          <div className="p-5 border-b flex items-center gap-2">
            <Clock size={16} className="text-[oklch(0.6_0.18_70)]" />
            <h3 className="font-semibold">Pending applications</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {pending.length} awaiting review
            </span>
          </div>
          <div className="divide-y">
            {pending.map((c) => (
              <div
                key={c.clinicId}
                className="p-5 flex flex-wrap items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="font-semibold text-base">{c.clinicName}</p>
                    <span
                      className={`text-[10px] tracking-wider px-2 py-0.5 rounded-full border capitalize ${
                        c.type === "private"
                          ? "text-[oklch(0.45_0.18_290)] border-[oklch(0.8_0.12_290)]"
                          : "text-[oklch(0.4_0.15_245)] border-[oklch(0.8_0.1_245)]"
                      }`}
                    >
                      {c.type}
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                    <DetailRow label="Contact person" value={c.contactName} />
                    <DetailRow label="Email" value={c.contactEmail} />
                    {c.contactPhone && (
                      <DetailRow label="Phone" value={c.contactPhone} />
                    )}
                    {c.address && (
                      <DetailRow label="Address" value={c.address} />
                    )}
                    {c.registrationNumber && (
                      <DetailRow
                        label="Registration no."
                        value={c.registrationNumber}
                      />
                    )}
                    <DetailRow label="Billing" value="Not set up yet" />
                  </dl>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => reject.mutate(c.clinicId)}
                    disabled={reject.isPending}
                    className="text-xs border px-3 py-1.5 rounded-md hover:bg-secondary inline-flex items-center gap-1"
                  >
                    <X size={13} /> Reject
                  </button>
                  <button
                    onClick={() => approve.mutate(c.clinicId)}
                    disabled={approve.isPending}
                    className="text-xs bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] inline-flex items-center gap-1"
                  >
                    <Check size={13} /> Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center gap-2">
          <Building2 size={16} />{" "}
          <h3 className="font-semibold">Active clinics</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {isLoading ? "Loading..." : `${active.length} live`}
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
            {active.map((c) => {
              const admins = users.filter(
                (u) => u.role === "admin" && u.clinicId === c.clinicId,
              );
              return (
                <tr key={c.clinicId} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {c.clinicName}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {admins.length > 0
                        ? `Admin: ${admins.map((a) => a.fullName ?? a.username).join(", ")}`
                        : "No admin assigned"}
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
                      onClick={() => remove.mutate(c.clinicId)}
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
            {!isLoading && active.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-muted-foreground text-sm"
                >
                  No active clinics yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
    password: "",
  });

  const assign = useMutation({
    mutationFn: () =>
      addUser({
        username: form.username.trim().toLowerCase(),
        password: form.password,
        role: "admin",
        fullName: form.fullName.trim(),
        clinicId: clinic.clinicId,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error || "Could not assign");
        return;
      }
      toast.success(
        `Assigned ${form.fullName} as Admin of ${clinic.clinicName}`,
      );
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onClose();
    },
    onError: () => toast.error("Could not assign clinic admin"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.username || !form.password) {
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
          <Field label="Password">
            <input
              required
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full border rounded-md px-3 py-2 text-sm"
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
              {assign.isPending ? "Assigning…" : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wider text-muted-foreground">
        {label.toUpperCase()}
      </dt>
      <dd className="text-sm truncate">{value ?? "—"}</dd>
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
