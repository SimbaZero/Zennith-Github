import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  addUser,
  STAFF_ROLES,
  useCurrentAdmin,
  type StaffRole,
} from "@/lib/auth";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({ component: CreateUser });

function CreateUser() {
  const { admin } = useCurrentAdmin();

  const [form, setForm] = useState({
    fullName: "",
    username: "",
    email: "",
    role: "doctor" as StaffRole,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: any) =>
    setForm({ ...form, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.email || !form.fullName) {
      toast.error("All fields are required");
      return;
    }
    if (admin?.clinicId == null) {
      toast.error(
        "Your admin account isn't linked to a clinic — contact the platform owner.",
      );
      return;
    }
    setSaving(true);
    const res = await addUser({
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
      fullName: form.fullName.trim(),
      clinicId: admin.clinicId,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not create user");
      return;
    }
    toast.success(
      `${form.fullName} created — a set-password email was sent to ${form.email}`,
    );
    setForm({ ...form, fullName: "", username: "", email: "" });
  };

  return (
    <AppShell
      role="admin"
      title="Create User"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      <div className="max-w-2xl mx-auto bg-white rounded-xl border p-6">
        <h2 className="font-semibold text-lg mb-1">New Staff Account</h2>
        <p className="text-sm text-muted-foreground mb-2">
          Patients are excluded — they are not hospital staff. Use this form for
          doctors, nurses, pharmacists and receptionists.
        </p>
        <div className="text-sm border rounded-md p-3 bg-secondary/30 mb-6">
          <p className="text-muted-foreground">
            They'll get an email to set their own password — you never see or
            choose it.
          </p>
          <p className="text-muted-foreground mt-2">
            <strong>Tell them to check their spam folder.</strong> The email
            comes from a Firebase address, which Gmail often filters. This stops
            once Zennith is on its own verified domain.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">
              Full name
            </label>
            <input
              value={form.fullName}
              onChange={(e) => set("fullName")(e.target.value)}
              required
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Username (used to log in)
              </label>
              <input
                value={form.username}
                onChange={(e) => set("username")(e.target.value.toLowerCase())}
                required
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
                required
                placeholder="their.name@example.com"
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Clinic</label>
            <div className="w-full px-3 py-2.5 border rounded-md bg-secondary/40 text-sm">
              {admin?.clinicName ?? "Loading…"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              New staff join your clinic. Doctors and pharmacists can be given
              additional clinics later.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Role</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {STAFF_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => set("role")(r)}
                  className={`px-3 py-2.5 rounded-md text-sm capitalize border transition ${
                    form.role === r
                      ? "bg-[oklch(0.55_0.18_245)] text-white border-transparent"
                      : "hover:bg-secondary"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() =>
                setForm({
                  fullName: "",
                  username: "",
                  email: "",
                  role: "doctor",
                })
              }
              className="border px-4 py-2 rounded-md text-sm hover:bg-secondary"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
            >
              {saving ? "Creating..." : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
