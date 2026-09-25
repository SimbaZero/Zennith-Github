import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
<<<<<<< Updated upstream
import {
  addUser,
  STAFF_ROLES,
  useCurrentAdmin,
  type StaffRole,
} from "@/lib/auth";
import { useState } from "react";
=======
import { addUser, STAFF_ROLES, getUserFacility, type StaffRole } from "@/lib/auth";
import { facilityName } from "@/lib/facilities";
import { useMemo, useState } from "react";
>>>>>>> Stashed changes
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/users")({ component: CreateUser });

// ---- Role-specific field definitions ----------------------------------
// Adjust these to match whatever fields actually exist (or should exist)
// in your Firestore staff/profile documents. Each field is rendered
// automatically based on the selected role.
type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "tel" | "email";
  /** If set, this field's value is force-prefixed and the prefix can't be edited/deleted. */
  lockedPrefix?: string;
};

// Registration numbers that must start with a fixed council prefix.
// Doctors -> HPCSA "MP" numbers, Nurses -> SANC "NUR" numbers.
const ROLE_FIELDS: Record<StaffRole, FieldDef[]> = {
  doctor: [
    { key: "licenseNumber", label: "HPCSA registration number", placeholder: "0123456", required: true, lockedPrefix: "MP" },
    { key: "specialty", label: "Specialty", placeholder: "e.g. General Practice", required: true },
    { key: "contactNumber", label: "Contact number", placeholder: "e.g. 082 123 4567", type: "tel" },
  ],
  nurse: [
    { key: "licenseNumber", label: "SANC registration number", placeholder: "0123456", required: true, lockedPrefix: "NUR" },
    { key: "ward", label: "Ward / department", placeholder: "e.g. Outpatients" },
    { key: "contactNumber", label: "Contact number", placeholder: "e.g. 082 123 4567", type: "tel" },
  ],
  pharmacist: [
    { key: "licenseNumber", label: "SAPC registration number", placeholder: "e.g. PHM0123456", required: true },
    { key: "contactNumber", label: "Contact number", placeholder: "e.g. 082 123 4567", type: "tel" },
  ],
  receptionist: [
    { key: "contactNumber", label: "Contact number", placeholder: "e.g. 082 123 4567", type: "tel" },
  ],
};

function generatePassword(length = 12) {
  // Mix of upper/lower/digits/symbols, avoids visually ambiguous chars.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(length);
  (window.crypto || (window as any).msCrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Ensures a value always starts with the given locked prefix and strips
// any attempt to type over/remove it. Whatever the user types after the
// prefix is preserved as-is (so "MP" + "0123456" -> "MP0123456").
function withLockedPrefix(prefix: string, raw: string) {
  const upper = raw.toUpperCase();
  if (!upper.startsWith(prefix)) {
    // User deleted into or past the prefix, or pasted something odd —
    // strip any partial/duplicate prefix attempt then re-apply it.
    const stripped = upper.replace(new RegExp(`^${prefix}`), "");
    return prefix + stripped.replace(new RegExp(`^${prefix}`), "");
  }
  return upper;
}

type IdType = "sa_id" | "passport";

function CreateUser() {
  const { admin } = useCurrentAdmin();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    username: "",
    email: "",
    role: "doctor" as StaffRole,
  });
  const [extra, setExtra] = useState<Record<string, string>>({ licenseNumber: "MP" });
  const [idType, setIdType] = useState<IdType>("sa_id");
  const [idValue, setIdValue] = useState("");
  const [saving, setSaving] = useState(false);
<<<<<<< Updated upstream
  const set = (k: keyof typeof form) => (v: any) =>
    setForm({ ...form, [k]: v });
=======

  const set = (k: keyof typeof form) => (v: any) => setForm({ ...form, [k]: v });
>>>>>>> Stashed changes

  const setExtraField = (field: FieldDef) => (v: string) => {
    const value = field.lockedPrefix ? withLockedPrefix(field.lockedPrefix, v) : v;
    setExtra((prev) => ({ ...prev, [field.key]: value }));
  };

  const fields = useMemo(() => ROLE_FIELDS[form.role] ?? [], [form.role]);

  const handleRoleChange = (r: StaffRole) => {
    // Reset role-specific fields when switching roles so stale values
    // from a previous role don't get submitted (e.g. leftover license #).
    // Pre-fill any locked-prefix fields (MP / NUR) so the admin can't
    // accidentally submit a registration number without the prefix.
    const nextFields = ROLE_FIELDS[r] ?? [];
    const seeded: Record<string, string> = {};
    for (const f of nextFields) {
      if (f.lockedPrefix) seeded[f.key] = f.lockedPrefix;
    }
    setForm({ ...form, role: r });
    setExtra(seeded);
  };

  const handleGeneratePassword = () => {
    set("password")(generatePassword());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
<<<<<<< Updated upstream
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
    // addUser now throws when offline (it calls Firebase Auth and sends an
    // email, neither of which Firestore's offline queue can carry). Catch it
    // so the admin sees why, instead of a form stuck on "Saving".
    try {
      const res = await addUser({
        username: form.username.trim(),
        email: form.email.trim(),
        role: form.role,
        fullName: form.fullName.trim(),
        clinicId: admin.clinicId,
      });
      if (!res.ok) {
        toast.error(res.error || "Could not create user");
        return;
      }
      toast.success(
        `${form.fullName} created — a set-password email was sent to ${form.email}`,
      );
      setForm({ ...form, fullName: "", username: "", email: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setSaving(false);
    }
=======
    if (!form.username || !form.password || !form.firstName || !form.lastName) {
      toast.error("All fields are required");
      return;
    }

    // A locked-prefix field ("MP" / "NUR") is only actually filled in
    // once something follows the prefix — otherwise it's still just
    // the placeholder prefix on its own.
    const missingField = fields.find((f) => {
      if (!f.required) return false;
      const v = extra[f.key]?.trim() ?? "";
      if (f.lockedPrefix) return v.length <= f.lockedPrefix.length;
      return !v;
    });
    if (missingField) {
      toast.error(`${missingField.label} is required`);
      return;
    }

    if (!idValue.trim()) {
      toast.error(idType === "sa_id" ? "South African ID number is required" : "Passport number is required");
      return;
    }
    if (idType === "sa_id" && !/^\d{13}$/.test(idValue.trim())) {
      toast.error("SA ID number must be 13 digits");
      return;
    }

    setSaving(true);
    // New staff are bound to the facility the signed-in admin is scoped to.
    const fid = getUserFacility();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;

    // addUser (in lib/auth.ts) now accepts all of these directly and:
    //  1. Checks licenseNumber / idNumber for duplicates first
    //  2. Creates the Firebase Auth account (password is hashed by
    //     Firebase — never touches Firestore or our own code)
    //  3. Writes the profile doc with role, name, and role-specific fields
    const res = await addUser({
      username: form.username.trim(),
      password: form.password,
      role: form.role,
      fullName,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      facilityId: fid ?? undefined,
      idType,
      idNumber: idValue.trim(),
      licenseNumber: extra.licenseNumber,
      specialty: extra.specialty,
      ward: extra.ward,
      contactNumber: extra.contactNumber,
    });

    setSaving(false);
    if (!res.ok) { toast.error(res.error || "Could not create user"); return; }
    toast.success(`${fullName} (${form.role}) created — they can log in with username "${form.username}"`);
    setForm({ firstName: "", lastName: "", username: "", password: "", role: form.role });
    setExtra(() => {
      const seeded: Record<string, string> = {};
      for (const f of ROLE_FIELDS[form.role] ?? []) if (f.lockedPrefix) seeded[f.key] = f.lockedPrefix;
      return seeded;
    });
    setIdType("sa_id");
    setIdValue("");
>>>>>>> Stashed changes
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">First name(s)</label>
              <input value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} required
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Surname</label>
              <input value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} required
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
            </div>
          </div>

          <div>
<<<<<<< Updated upstream
            <label className="text-sm font-medium block mb-1.5">
              Full name
            </label>
            <input
              value={form.fullName}
              onChange={(e) => set("fullName")(e.target.value)}
              required
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
=======
            <label className="text-sm font-medium block mb-2">Identification</label>
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={idType === "sa_id"}
                  onChange={() => { setIdType("sa_id"); setIdValue(""); }}
                  className="w-4 h-4"
                />
                South African ID number
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={idType === "passport"}
                  onChange={() => { setIdType("passport"); setIdValue(""); }}
                  className="w-4 h-4"
                />
                Passport number
              </label>
            </div>
            <input
              value={idValue}
              onChange={(e) => setIdValue(idType === "sa_id" ? e.target.value.replace(/\D/g, "").slice(0, 13) : e.target.value)}
              placeholder={idType === "sa_id" ? "13-digit SA ID number" : "Passport number"}
              required
              inputMode={idType === "sa_id" ? "numeric" : "text"}
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] font-mono text-sm"
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
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
=======
              <label className="text-sm font-medium block mb-1.5">Password</label>
              <div className="flex gap-2">
                <input type="text" value={form.password} onChange={(e) => set("password")(e.target.value)} required
                  className="flex-1 px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] font-mono text-sm" />
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  title="Generate random password"
                  className="px-3 rounded-md border hover:bg-secondary flex items-center justify-center"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Share this with the staff member directly — min. 6 characters (Firebase requirement).
              </p>
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
                <button
                  key={r}
                  type="button"
                  onClick={() => set("role")(r)}
=======
                <button key={r} type="button" onClick={() => handleRoleChange(r)}
>>>>>>> Stashed changes
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

          {fields.length > 0 && (
            <div className="border-t pt-4">
              <label className="text-sm font-medium block mb-2 capitalize">{form.role} details</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.map((f) => (
                  <div key={f.key}>
                    <label className="text-sm font-medium block mb-1.5">
                      {f.label}{f.required && <span className="text-destructive"> *</span>}
                    </label>
                    <input
                      type={f.type ?? "text"}
                      value={extra[f.key] ?? (f.lockedPrefix ?? "")}
                      onChange={(e) => setExtraField(f)(e.target.value)}
                      onKeyDown={(e) => {
                        // Block backspace/delete from eating into the locked prefix.
                        if (!f.lockedPrefix) return;
                        const el = e.currentTarget;
                        const atOrBeforePrefixEnd = el.selectionStart !== null && el.selectionStart <= f.lockedPrefix.length;
                        if ((e.key === "Backspace" || e.key === "Delete") && atOrBeforePrefixEnd && el.selectionStart === el.selectionEnd) {
                          e.preventDefault();
                        }
                      }}
                      placeholder={f.lockedPrefix ? `${f.lockedPrefix}${f.placeholder}` : f.placeholder}
                      required={f.required}
                      className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
<<<<<<< Updated upstream
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
=======
            <button type="button" onClick={() => { setForm({ firstName: "", lastName: "", username: "", password: "", role: "doctor" }); setExtra({ licenseNumber: "MP" }); setIdType("sa_id"); setIdValue(""); }}
              className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">Reset</button>
            <button type="submit" disabled={saving}
              className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60">
>>>>>>> Stashed changes
              {saving ? "Creating..." : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
