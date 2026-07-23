import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";

export const Route = createFileRoute("/signup")({ component: Signup });

function Signup() {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState<"patient" | "clinic">("patient");
  const [clinicKind, setClinicKind] = useState<"public" | "private">("public");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[+\d\s-]{7,}$/.test(form.phone)) { setError("Enter a valid phone number."); return; }
    if (form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (form.password !== form.confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    setTimeout(() => navigate({ to: "/login" }), 800);
  };

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground">Join the Zennith care platform</p>
        </div>

        {/* Account type selector */}
        <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-secondary rounded-lg">
          <button
            type="button"
            onClick={() => setAccountType("patient")}
            className={`py-2 rounded-md text-sm font-medium transition ${accountType === "patient" ? "bg-white shadow-sm" : "text-muted-foreground"}`}
          >
            Patient
          </button>
          <button
            type="button"
            onClick={() => setAccountType("clinic")}
            className={`py-2 rounded-md text-sm font-medium transition ${accountType === "clinic" ? "bg-white shadow-sm" : "text-muted-foreground"}`}
          >
            Clinic staff
          </button>
        </div>

        {accountType === "clinic" && (
          <div className="mb-5 p-3 rounded-md bg-[oklch(0.97_0.03_245)] border border-[oklch(0.85_0.08_245)] text-xs text-muted-foreground space-y-3">
            <div>
              <div className="flex gap-2">
                {(["public", "private"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setClinicKind(k)}
                    className={`px-3 py-1 rounded-full text-xs border ${clinicKind === k ? "bg-[oklch(0.55_0.18_245)] text-white border-[oklch(0.55_0.18_245)]" : "bg-white"}`}
                  >
                    {k === "public" ? "Public clinic" : "Private clinic"}
                  </button>
                ))}
              </div>
            </div>
            <p>
              Clinic staff accounts (doctor, nurse, pharmacist, receptionist) are created by your
              clinic admin. Fill this out to request access — an admin at your {clinicKind} clinic
              must approve it.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Phone number" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="082 123 4567" />
          <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
          <Field label="Confirm password" type="password" value={form.confirm} onChange={(v) => setForm({ ...form, confirm: v })} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            disabled={loading}
            className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {loading ? "Creating..." : accountType === "clinic" ? "Request staff access" : "Create account"}
          </button>
          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-[oklch(0.55_0.18_245)] font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </AuthBackground>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
      />
    </div>
  );
}
