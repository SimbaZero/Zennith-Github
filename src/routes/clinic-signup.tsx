import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { submitClinicApplication } from "@/lib/clinic-data";
import { AuthBackground } from "@/components/AuthBackground";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/clinic-signup")({
  component: ClinicSignup,
});

function ClinicSignup() {
  const [form, setForm] = useState({
    clinicName: "",
    type: "public" as "public" | "private",
    address: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    registrationNumber: "",
    agreedToTerms: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.clinicName.trim() ||
      !form.contactName.trim() ||
      !form.contactEmail.trim()
    ) {
      toast.error("Clinic name, your name, and your email are required");
      return;
    }
    if (form.type === "private" && !form.registrationNumber.trim()) {
      toast.error("Private clinics need a practice registration number");
      return;
    }
    if (!form.agreedToTerms) {
      toast.error("Please confirm you accept the plan terms");
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
      });
      setDone(true);
    } catch (err) {
      console.error(err);
      toast.error(
        "Something went wrong submitting your application. Please try again.",
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
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">
              Clinic name
            </label>
            <input
              required
              value={form.clinicName}
              onChange={(e) => setForm({ ...form, clinicName: e.target.value })}
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {(["public", "private"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, type: t })}
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
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Practice registration number
              </label>
              <input
                required
                value={form.registrationNumber}
                onChange={(e) =>
                  setForm({ ...form, registrationNumber: e.target.value })
                }
                placeholder="e.g. your HPCSA / facility registration number"
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium block mb-1.5">
              Address (optional)
            </label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Street, suburb, city — write it however feels natural"
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Your name
              </label>
              <input
                required
                value={form.contactName}
                onChange={(e) =>
                  setForm({ ...form, contactName: e.target.value })
                }
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Your phone (optional)
              </label>
              <input
                value={form.contactPhone}
                onChange={(e) =>
                  setForm({ ...form, contactPhone: e.target.value })
                }
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">
              Your email
            </label>
            <input
              required
              type="email"
              value={form.contactEmail}
              onChange={(e) =>
                setForm({ ...form, contactEmail: e.target.value })
              }
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>

          <div className="border rounded-md p-4 bg-secondary/30">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
              YOUR PLAN
            </p>
            <p className="text-sm font-medium capitalize">
              {form.type} clinic — Standard
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Full platform access: patient records, appointments, queue
              management, stock control and staff accounts.
            </p>
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
              Pricing is confirmed with you after your application is approved —
              no payment details are collected now, and nothing is charged
              during onboarding.
            </p>
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.agreedToTerms}
                onChange={(e) =>
                  setForm({ ...form, agreedToTerms: e.target.checked })
                }
                className="mt-0.5"
              />
              <span className="text-xs">
                I understand this application is subject to approval, and that
                billing will be arranged directly with me before my clinic goes
                live.
              </span>
            </label>
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
