import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import {
  signUpPatient,
  fetchRealClinics,
  idNumberInUse,
} from "@/lib/clinic-data";
import { sendWelcomeEmail } from "@/lib/welcome-email";

export const Route = createFileRoute("/signup")({ component: Signup });

// SA ID numbers are 13 digits. Passports vary by country, so anything
// alphanumeric of a sensible length is accepted instead of guessing a format.
const SA_ID = /^\d{13}$/;
const PASSPORT = /^[A-Za-z0-9]{6,12}$/;

function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    idType: "id" as "id" | "passport",
    idNumber: "",
    password: "",
    confirm: "",
    clinicId: "",
  });
  const [error, setError] = useState("");
  const [checkingId, setCheckingId] = useState(false);

  const { data: clinics = [], isLoading: clinicsLoading } = useQuery({
    queryKey: ["signup-clinics"],
    queryFn: fetchRealClinics,
  });

  const signup = useMutation({
    mutationFn: async () => {
      const res = await signUpPatient({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        clinicId: Number(form.clinicId),
        idNumber: form.idNumber.trim(),
      });
      if (!res.ok) return { ...res, mailOk: false };
      // Confirmation email via Resend (server-side). Never blocks signup —
      // delivery status is reported separately.
      const mail = await sendWelcomeEmail({
        data: { email: form.email, name: form.name, patientId: res.patientId },
      }).catch(() => ({ ok: false }));
      return { ...res, mailOk: mail.ok };
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setError(res.error || "Could not create account");
        return;
      }
      toast.success(
        res.mailOk
          ? `Account created (${res.patientId}). We've sent a confirmation email to ${form.email} — check your inbox, then sign in.`
          : `Account created (${res.patientId}). You can sign in now (confirmation email couldn't be sent).`,
        { duration: 7000 },
      );
      navigate({ to: "/login" });
    },
    onError: () => setError("Could not create account — please try again"),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!/^[+\d\s-]{7,}$/.test(form.phone)) {
      setError("Enter a valid phone number.");
      return;
    }

    const id = form.idNumber.trim();
    if (form.idType === "id" && !SA_ID.test(id)) {
      setError("A South African ID number is 13 digits.");
      return;
    }
    if (form.idType === "passport" && !PASSPORT.test(id)) {
      setError("Enter a valid passport number.");
      return;
    }

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!form.clinicId) {
      setError("Please choose your nearest clinic.");
      return;
    }

    // Checked here so the person gets a clear message before an account is
    // attempted. signUpPatient checks again server-side — this is convenience,
    // not the safeguard.
    setCheckingId(true);
    const taken = await idNumberInUse(id).catch(() => false);
    setCheckingId(false);
    if (taken) {
      setError(
        "An account already exists with this ID number. Try signing in, or use 'Forgot password'.",
      );
      return;
    }

    signup.mutate();
  };

  const busy = signup.isPending || checkingId;

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 my-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            Join the Zennith care platform
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Full name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
          />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
          />
          <Field
            label="Phone number"
            type="tel"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="082 123 4567"
          />

          <div>
            <label className="text-sm font-medium block mb-1.5">
              Identification
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {(
                [
                  ["id", "SA ID number"],
                  ["passport", "Passport"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm({ ...form, idType: key })}
                  className={`px-3 py-2 rounded-md text-sm border transition ${
                    form.idType === key
                      ? "bg-[oklch(0.55_0.18_245)] text-white border-transparent"
                      : "hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={form.idNumber}
              onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
              placeholder={
                form.idType === "id" ? "13 digits" : "Passport number"
              }
              required
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Links you to your medical file and stops a second record being
              created for you by mistake.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">
              Nearest clinic
            </label>
            <select
              value={form.clinicId}
              onChange={(e) => setForm({ ...form, clinicId: e.target.value })}
              required
              disabled={clinicsLoading}
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
            >
              <option value="" disabled>
                {clinicsLoading ? "Loading clinics..." : "Select a clinic"}
              </option>
              {clinics.map((c) => (
                <option key={c.clinicId} value={c.clinicId}>
                  {c.clinicName}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
          />
          <Field
            label="Confirm password"
            type="password"
            value={form.confirm}
            onChange={(v) => setForm({ ...form, confirm: v })}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            disabled={busy}
            className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {checkingId
              ? "Checking..."
              : signup.isPending
                ? "Creating..."
                : "Create account"}
          </button>
          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-[oklch(0.55_0.18_245)] font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </AuthBackground>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
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
