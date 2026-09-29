import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import { Field, FieldError, PasswordChecklist } from "@/components/FormField";
import { focusFirstError, inputClass } from "@/lib/form-ui";
import {
  signUpPatient,
  fetchRealClinics,
  idNumberInUse,
} from "@/lib/clinic-data";
import { sendWelcomeEmail } from "@/lib/welcome-email";
import {
  fieldForServerError,
  friendlyServerMessage,
  normalizeId,
  SIGNUP_FIELD_ORDER,
  validateSignupForm,
  type SignupErrors,
  type SignupFormValues,
} from "@/lib/form-rules";
import {
  DOCUMENT_CHECK_NOTE,
  ID_TYPE_LABELS,
  SA_ID_CHECK_NOTE,
  validateSaId,
} from "@/lib/sa-id";

export const Route = createFileRoute("/signup")({ component: Signup });

// An SA ID is validated strictly (date of birth, citizenship digit, Luhn);
// passports and asylum/refugee permits get a format-only check — see sa-id.ts.
// Asylum seekers and refugees must be able to sign up too; a patient with no
// document at all can still be registered in person at reception.

const FIELD_PREFIX = "signup";

function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupFormValues>({
    name: "",
    email: "",
    phone: "",
    idType: "sa_id",
    idNumber: "",
    password: "",
    confirm: "",
    clinicId: "",
  });
  // Problems tied to one field (shown in red under that field) …
  const [errors, setErrors] = useState<SignupErrors>({});
  // … and problems that belong to the whole form (e.g. sign-in not enabled).
  const [error, setError] = useState("");

  // Decoded live so the person can see we read their date of birth correctly.
  const saIdCheck =
    form.idType === "sa_id" ? validateSaId(form.idNumber) : null;
  const [checkingId, setCheckingId] = useState(false);

  const { data: clinics = [], isLoading: clinicsLoading } = useQuery({
    queryKey: ["signup-clinics"],
    queryFn: fetchRealClinics,
  });

  // Updates one value and clears that field's red error as soon as the person
  // starts fixing it.
  const set = <K extends keyof SignupFormValues>(
    key: K,
    value: SignupFormValues[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => {
      const next: Record<string, string | undefined> = { ...prev };
      delete next[key];
      if (key === "password") delete next.confirm;
      return next;
    });
  };

  const showFieldErrors = (found: SignupErrors) => {
    setErrors(found);
    focusFirstError(SIGNUP_FIELD_ORDER, found, FIELD_PREFIX);
  };

  const signup = useMutation({
    mutationFn: async () => {
      const res = await signUpPatient({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        clinicId: Number(form.clinicId),
        idNumber: normalizeId(form.idNumber, form.idType),
        idType: form.idType,
        dob: saIdCheck?.valid ? saIdCheck.dateOfBirth : undefined,
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
        const raw = res.error || "Could not create account";
        const message = friendlyServerMessage(raw);
        const field = fieldForServerError(raw);
        if (field) showFieldErrors({ [field]: message });
        else setError(message);
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

    // Every field is checked at once, so the person sees all the problems
    // (each in red under its own field) instead of fixing them one by one.
    const found = validateSignupForm(form);
    if (Object.keys(found).length > 0) {
      showFieldErrors(found);
      return;
    }

    // Checked here so the person gets a clear message before an account is
    // attempted. signUpPatient checks again server-side — this is convenience,
    // not the safeguard.
    setCheckingId(true);
    const taken = await idNumberInUse(
      normalizeId(form.idNumber, form.idType),
    ).catch(() => false);
    setCheckingId(false);
    if (taken) {
      showFieldErrors({
        idNumber:
          "An account already exists with this ID number. Try signing in, or use 'Forgot password'.",
      });
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
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            id={`${FIELD_PREFIX}-name`}
            label="Full name"
            value={form.name}
            onChange={(v) => set("name", v)}
            error={errors.name}
            autoComplete="name"
          />
          <Field
            id={`${FIELD_PREFIX}-email`}
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => set("email", v)}
            error={errors.email}
            autoComplete="email"
          />
          <Field
            id={`${FIELD_PREFIX}-phone`}
            label="Phone number"
            type="tel"
            value={form.phone}
            onChange={(v) => set("phone", v)}
            placeholder="082 123 4567"
            error={errors.phone}
            autoComplete="tel"
          />

          <div>
            <label
              htmlFor={`${FIELD_PREFIX}-idNumber`}
              className="text-sm font-medium block mb-1.5"
            >
              Identification
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {(
                [
                  ["sa_id", "SA ID number"],
                  ["passport", "Passport"],
                  ["asylum", ID_TYPE_LABELS.asylum],
                  ["refugee", ID_TYPE_LABELS.refugee],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set("idType", key)}
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
              id={`${FIELD_PREFIX}-idNumber`}
              value={form.idNumber}
              onChange={(e) => set("idNumber", e.target.value)}
              placeholder={
                form.idType === "sa_id"
                  ? "13 digits"
                  : `${ID_TYPE_LABELS[form.idType]} number`
              }
              aria-invalid={errors.idNumber ? true : undefined}
              className={inputClass(!!errors.idNumber)}
            />
            <FieldError
              id={`${FIELD_PREFIX}-idNumber-error`}
              message={errors.idNumber}
            />
            {saIdCheck?.valid && (
              <p className="text-xs text-muted-foreground mt-1">
                Date of birth:{" "}
                <strong>
                  {new Date(saIdCheck.dateOfBirth!).toLocaleDateString(
                    "en-ZA",
                    {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    },
                  )}
                </strong>{" "}
                (from your ID number)
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Links you to your medical file and stops a second record being
              created for you by mistake.{" "}
              {form.idType === "sa_id" ? SA_ID_CHECK_NOTE : DOCUMENT_CHECK_NOTE}
            </p>
          </div>

          <div>
            <label
              htmlFor={`${FIELD_PREFIX}-clinicId`}
              className="text-sm font-medium block mb-1.5"
            >
              Nearest clinic
            </label>
            <select
              id={`${FIELD_PREFIX}-clinicId`}
              value={form.clinicId}
              onChange={(e) => set("clinicId", e.target.value)}
              disabled={clinicsLoading}
              aria-invalid={errors.clinicId ? true : undefined}
              className={inputClass(!!errors.clinicId, "bg-white")}
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
            <FieldError
              id={`${FIELD_PREFIX}-clinicId-error`}
              message={errors.clinicId}
            />
          </div>

          <Field
            id={`${FIELD_PREFIX}-password`}
            label="Password"
            type="password"
            value={form.password}
            onChange={(v) => set("password", v)}
            error={errors.password}
            autoComplete="new-password"
            hint={<PasswordChecklist value={form.password} />}
          />
          <Field
            id={`${FIELD_PREFIX}-confirm`}
            label="Confirm password"
            type="password"
            value={form.confirm}
            onChange={(v) => set("confirm", v)}
            error={errors.confirm}
            autoComplete="new-password"
          />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

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
