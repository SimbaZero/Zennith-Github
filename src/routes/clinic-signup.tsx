import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { submitClinicApplication } from "@/lib/clinic-data";
import { AuthBackground } from "@/components/AuthBackground";
import { Field, FieldError } from "@/components/FormField";
import { focusFirstError } from "@/lib/form-ui";
import {
  PRICING_DISCLAIMER,
  PRIVATE_PLAN,
  annualMonthsFree,
  buildBilling,
  formatZar,
  priceLine,
} from "@/lib/plans";
import {
  CLINIC_FIELD_ORDER,
  QUOTA_MESSAGE,
  isQuotaError,
  validateClinicForm,
  type ClinicErrors,
  type ClinicFormValues,
} from "@/lib/form-rules";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/clinic-signup")({
  component: ClinicSignup,
});

const FIELD_PREFIX = "clinic";

function ClinicSignup() {
  const [form, setForm] = useState<ClinicFormValues>({
    clinicName: "",
    type: "public",
    address: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    registrationNumber: "",
    agreedToTerms: false,
    billingCycle: "monthly",
    trialRequested: true,
    billingEmail: "",
  });
  // Each problem is shown in red under the field it belongs to.
  const [errors, setErrors] = useState<ClinicErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Updates one value and clears that field's red error as soon as the person
  // starts fixing it.
  const set = <K extends keyof ClinicFormValues>(
    key: K,
    value: ClinicFormValues[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => {
      const next: Record<string, string | undefined> = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Every field is checked at once, so the person sees all the problems
    // instead of fixing them one pop-up at a time.
    const found = validateClinicForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      focusFirstError(CLINIC_FIELD_ORDER, found, FIELD_PREFIX);
      return;
    }

    setSubmitting(true);
    try {
      await submitClinicApplication({
        clinicName: form.clinicName.trim(),
        type: form.type,
        address: form.address.trim() || undefined,
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim() || undefined,
        registrationNumber: form.registrationNumber.trim() || undefined,
        plan: form.type === "private" ? "private-standard" : "public-standard",
        billing: buildBilling(form),
      });
      setDone(true);
    } catch (err) {
      console.error(err);
      toast.error(
        isQuotaError(err)
          ? QUOTA_MESSAGE
          : "Something went wrong submitting your application. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthBackground videoSrc="/login-bg.mp4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center animate-fade-up">
          <Building2
            size={32}
            className="mx-auto mb-4 text-[oklch(0.55_0.18_245)]"
          />
          <h1 className="text-lg font-semibold mb-2">Application submitted</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Thanks — your clinic application is pending review. We'll be in
            touch at <strong>{form.contactEmail}</strong> once it's approved.
          </p>
          <Link
            to="/login"
            className="text-sm text-[oklch(0.55_0.18_245)] hover:underline"
          >
            ← Back to login
          </Link>
        </div>
      </AuthBackground>
    );
  }

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-8 my-8 animate-fade-up">
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={20} className="text-[oklch(0.55_0.18_245)]" />
          <h1 className="text-lg font-semibold">Register your clinic</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Fill in your details below. A Zennith administrator will review and
          approve your application — no call or office visit needed.
        </p>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            id={`${FIELD_PREFIX}-clinicName`}
            label="Clinic name"
            value={form.clinicName}
            onChange={(v) => set("clinicName", v)}
            error={errors.clinicName}
          />
          <div>
            <label className="text-sm font-medium block mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["public", "private"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("type", t)}
                  className={`px-3 py-2.5 rounded-md text-sm capitalize border transition ${
                    form.type === t
                      ? "bg-[oklch(0.55_0.18_245)] text-white border-transparent"
                      : "hover:bg-secondary"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {form.type === "private" && (
            <Field
              id={`${FIELD_PREFIX}-registrationNumber`}
              label="Practice registration number"
              value={form.registrationNumber}
              onChange={(v) => set("registrationNumber", v)}
              placeholder="e.g. your HPCSA / facility registration number"
              error={errors.registrationNumber}
              hint={
                <p className="text-xs text-muted-foreground mt-1">
                  This number is not checked automatically yet — a Zennith
                  administrator verifies it by hand. Automatic checking needs a
                  paid regulator data service that isn't connected.
                </p>
              }
            />
          )}
          <div>
            <label className="text-sm font-medium block mb-1.5">
              Address (optional)
            </label>
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Street, suburb, city — write it however feels natural"
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              id={`${FIELD_PREFIX}-contactName`}
              label="Your name"
              value={form.contactName}
              onChange={(v) => set("contactName", v)}
              error={errors.contactName}
              autoComplete="name"
            />
            <Field
              id={`${FIELD_PREFIX}-contactPhone`}
              label="Your phone (optional)"
              type="tel"
              value={form.contactPhone}
              onChange={(v) => set("contactPhone", v)}
              error={errors.contactPhone}
              autoComplete="tel"
            />
          </div>
          <Field
            id={`${FIELD_PREFIX}-contactEmail`}
            label="Your email"
            type="email"
            value={form.contactEmail}
            onChange={(v) => set("contactEmail", v)}
            error={errors.contactEmail}
            autoComplete="email"
          />

          <div
            className={`border rounded-md p-4 bg-secondary/30 ${
              errors.agreedToTerms ? "border-destructive" : ""
            }`}
          >
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
              YOUR PLAN
            </p>
            {form.type === "private" ? (
              <div>
                <p className="text-sm font-medium">{PRIVATE_PLAN.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Full platform access: patient records, appointments, queue
                  management, stock control and staff accounts. Includes{" "}
                  {PRIVATE_PLAN.includedLogins} staff logins; each extra login
                  is {formatZar(PRIVATE_PLAN.extraLoginMonthlyZar)} a month.
                </p>
                <div
                  className="grid grid-cols-2 gap-2 mt-3"
                  role="group"
                  aria-label="Billing cycle"
                >
                  {(["monthly", "annual"] as const).map((cycle) => (
                    <button
                      key={cycle}
                      type="button"
                      aria-pressed={form.billingCycle === cycle}
                      onClick={() => set("billingCycle", cycle)}
                      className={`rounded-md border px-3 py-2.5 text-left transition ${
                        form.billingCycle === cycle
                          ? "bg-[oklch(0.55_0.18_245)] text-white border-transparent"
                          : "bg-white hover:bg-secondary"
                      }`}
                    >
                      <span className="block text-sm font-medium capitalize">
                        {cycle}
                      </span>
                      <span className="block text-xs">{priceLine(cycle)}</span>
                      {cycle === "annual" && (
                        <span className="block text-[11px] opacity-90">
                          {annualMonthsFree()} months free
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <label className="flex items-start gap-2 mt-3 cursor-pointer">
                  <input
                    id={`${FIELD_PREFIX}-trialRequested`}
                    type="checkbox"
                    checked={form.trialRequested}
                    onChange={(e) => set("trialRequested", e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    Start with a {PRIVATE_PLAN.trialDays}-day free trial.
                    Billing begins after the trial.
                  </span>
                </label>
                {/* "Send invoices to" is hidden until billing exists — no
                    invoices are sent yet, so asking for an address implied a
                    feature that isn't there. The billingEmail field and its
                    validation are untouched, so restoring this is putting the
                    Field back here. */}
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">Public clinic — Pilot</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Full platform access: patient records, appointments, queue
                  management, stock control and staff accounts. No payment is
                  taken through this form. Terms for public clinics are
                  confirmed with you after approval.
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
              {PRICING_DISCLAIMER}
            </p>
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                id={`${FIELD_PREFIX}-agreedToTerms`}
                type="checkbox"
                checked={form.agreedToTerms}
                onChange={(e) => set("agreedToTerms", e.target.checked)}
                aria-invalid={errors.agreedToTerms ? true : undefined}
                className="mt-0.5"
              />
              <span className="text-xs">
                I understand this application is subject to approval, and that
                billing will be arranged directly with me before my clinic goes
                live.
              </span>
            </label>
            <FieldError
              id={`${FIELD_PREFIX}-agreedToTerms-error`}
              message={errors.agreedToTerms}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit application"}
          </button>
          <p className="text-xs text-center text-muted-foreground">
            <Link to="/login" className="hover:underline">
              ← Back to login
            </Link>
          </p>
        </form>
      </div>
    </AuthBackground>
  );
}
