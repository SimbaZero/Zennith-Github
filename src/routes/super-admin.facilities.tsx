import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { useFacilities, registerFacility, removeFacility, type Facility } from "@/lib/facilities";
import { addUser, getUsers, getUsername } from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Plus, Trash2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/super-admin/facilities")({ component: SuperFacilities });

const KINDS: Facility["kind"][] = ["Public Hospital", "Private Hospital", "Clinic", "Healthcare Centre"];

function SuperFacilities() {
  const facilities = useFacilities();
  // Accounts now live in Firestore, so the admin-per-facility lookup is async.
  const { data: users = [] } = useQuery({ queryKey: ["profiles"], queryFn: getUsers });
  const [form, setForm] = useState({ name: "", area: "", kind: "Public Hospital" as Facility["kind"] });
  const [assign, setAssign] = useState<{ open: boolean; facility: Facility | null }>({ open: false, facility: null });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.area.trim()) { toast.error("Name and area are required"); return; }
    const rec = registerFacility({ name: form.name.trim(), area: form.area.trim(), kind: form.kind }, getUsername() || "superadmin");
    toast.success(`Registered ${rec.name}`);
    setForm({ name: "", area: "", kind: "Public Hospital" });
  };

  const del = (id: string, name: string) => {
    removeFacility(id, getUsername() || "superadmin");
    toast.success(`Removed ${name}`);
  };

  return (
    <AppShell role="super_admin" title="Facilities">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-4">
            <Plus size={16} /> <h3 className="font-semibold">Register a facility</h3>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Facility name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Helen Joseph Hospital"
                className="w-full border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Area / suburb</label>
              <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="Auckland Park, Johannesburg"
                className="w-full border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Facility["kind"] })}
                className="w-full border rounded-md px-3 py-2 text-sm bg-white">
                {KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <button type="submit" className="w-full bg-[oklch(0.55_0.18_245)] text-white py-2 rounded-md text-sm">
              Register facility
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-5 border-b flex items-center gap-2">
            <Building2 size={16} /> <h3 className="font-semibold">Registered facilities</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Facility</th>
                <th className="px-5 py-3 font-medium">Area</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Registered</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {facilities.map((f) => {
                const admins = users.filter((u) => u.role === "admin" && u.facilityId === f.id);
                return (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">
                      {f.name}
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {admins.length > 0 ? `Admin: ${admins.map((a) => a.fullName ?? a.username).join(", ")}` : "No admin assigned"}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{f.area}</td>
                    <td className="px-5 py-3">{f.kind}</td>
                    <td className="px-5 py-3 text-muted-foreground">{f.createdAt}</td>
                    <td className="px-5 py-3 text-right space-x-1">
                      <button onClick={() => setAssign({ open: true, facility: f })} className="text-xs border px-2 py-1 rounded hover:bg-secondary inline-flex items-center gap-1">
                        <ShieldCheck size={12} /> Assign Admin
                      </button>
                      <button onClick={() => del(f.id, f.name)} className="text-destructive hover:bg-destructive/10 p-1.5 rounded inline-flex" aria-label="Remove"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {assign.open && assign.facility && (
        <AssignAdmin facility={assign.facility} onClose={() => setAssign({ open: false, facility: null })} />
      )}
    </AppShell>
  );
}

function AssignAdmin({ facility, onClose }: { facility: Facility; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ fullName: "", username: "", password: "" });

  // Creates a real Firebase Auth account + Firestore profile scoped to this facility.
  const assign = useMutation({
    mutationFn: () =>
      addUser({
        username: form.username.trim().toLowerCase(),
        password: form.password,
        role: "admin",
        fullName: form.fullName.trim(),
        facilityId: facility.id,
      }),
    onSuccess: (res) => {
      if (!res.ok) { toast.error(res.error || "Could not assign"); return; }
      toast.success(`Assigned ${form.fullName} as Admin of ${facility.name}`);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onClose();
    },
    onError: () => toast.error("Could not assign facility admin"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName || !form.username || !form.password) { toast.error("All fields required"); return; }
    assign.mutate();
  };
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white border-l shadow-xl h-full overflow-y-auto p-6">
        <p className="text-[10px] tracking-wider text-muted-foreground">ASSIGN FACILITY ADMIN</p>
        <h2 className="font-semibold text-lg mt-1">{facility.name}</h2>
        <p className="text-xs text-muted-foreground mb-5">{facility.kind} · {facility.area}</p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name"><input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></Field>
          <Field label="Username"><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} className="w-full border rounded-md px-3 py-2 text-sm" /></Field>
          <Field label="Password"><input required type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm" /></Field>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border py-2 rounded-md text-sm">Cancel</button>
            <button type="submit" disabled={assign.isPending} className="flex-1 bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-sm disabled:opacity-60">
              {assign.isPending ? "Assigning…" : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
