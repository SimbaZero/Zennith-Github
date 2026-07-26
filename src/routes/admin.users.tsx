import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { addUser, STAFF_ROLES, getUserFacility, type StaffRole } from "@/lib/auth";
import { facilityName } from "@/lib/facilities";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({ component: CreateUser });

function CreateUser() {
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "doctor" as StaffRole,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: any) => setForm({ ...form, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password || !form.fullName) {
      toast.error("All fields are required");
      return;
    }
    setSaving(true);
    // New staff are bound to the facility the signed-in admin is scoped to.
    const fid = getUserFacility();
    const res = await addUser({
      username: form.username.trim(),
      password: form.password,
      role: form.role,
      fullName: form.fullName.trim(),
      facilityId: fid ?? undefined,
    });
    setSaving(false);
    if (!res.ok) { toast.error(res.error || "Could not create user"); return; }
    toast.success(`${form.fullName} (${form.role}) created — login with username "${form.username}"`);
    setForm({ fullName: "", username: "", password: "", role: form.role });
  };

  return (
    <AppShell role="admin" title="Create User">
      <div className="max-w-2xl bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-lg mb-1">New Staff Account</h2>
        <p className="text-xs text-muted-foreground mb-1">
          Scope: <span className="font-medium">{facilityName(getUserFacility())}</span> — new accounts are bound to your facility.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Patients are excluded — they are not hospital staff. Use this form for doctors, nurses, pharmacists and receptionists.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Full name</label>
            <input value={form.fullName} onChange={(e) => set("fullName")(e.target.value)} required
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">Username (used to log in)</label>
              <input value={form.username} onChange={(e) => set("username")(e.target.value.toLowerCase())} required
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Password</label>
              <input type="text" value={form.password} onChange={(e) => set("password")(e.target.value)} required
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Role</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {STAFF_ROLES.map((r) => (
                <button key={r} type="button" onClick={() => set("role")(r)}
                  className={`px-3 py-2.5 rounded-md text-sm capitalize border transition ${
                    form.role === r ? "bg-[oklch(0.55_0.18_245)] text-white border-transparent" : "hover:bg-secondary"
                  }`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setForm({ fullName: "", username: "", password: "", role: "doctor" })}
              className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">Reset</button>
            <button type="submit" disabled={saving}
              className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60">
              {saving ? "Creating..." : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
