import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ClinicRecord } from "@/lib/clinic-data";
import type { ClinicBillingSettings } from "@/lib/billing";
import {
  saveBillingSettings,
  suggestedSettings,
  validateSettings,
} from "@/lib/billing-service";
import { BILLING_CONFIG, type PlanType } from "@/config/billing";
import { formatCents } from "@/lib/billing";

// ---------------------------------------------------------------------------
// Super Admin: edit one clinic's billing settings. Same slide-in panel style
// as "Assign Admin" on the Facilities page. Saving affects drafts made from
// now on only — issued invoices keep their own copy.
// ---------------------------------------------------------------------------

const PLAN_OPTIONS: Array<{ value: PlanType; label: string; hint: string }> = [
  {
    value: "public",
    label: "Public: per active patient",
    hint: `${formatCents(BILLING_CONFIG.public.perActivePatientCents)} per active patient per month, ${BILLING_CONFIG.public.paymentTermsDays}-day terms`,
  },
  {
    value: "private",
    label: "Private: monthly subscription by size",
    hint: `${formatCents(BILLING_CONFIG.private.tiers.small.monthlyCents)} / ${formatCents(BILLING_CONFIG.private.tiers.medium.monthlyCents)} / ${formatCents(BILLING_CONFIG.private.tiers.large.monthlyCents)} by active patients, prorated by active days, ${BILLING_CONFIG.private.paymentTermsDays}-day terms`,
  },
  {
    value: "pilot",
    label: "Pilot: no charge",
    hint: "Still gets an R0.00 invoice each month, showing the pilot end date",
  },
];

export function BillingSettingsDrawer({
  clinic,
  current,
  onClose,
}: {
  clinic: ClinicRecord;
  /** Saved settings, or null if this clinic has never been set up. */
  current: ClinicBillingSettings | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClinicBillingSettings>(
    current ?? suggestedSettings(clinic),
  );
  const set = <K extends keyof ClinicBillingSettings>(
    k: K,
    v: ClinicBillingSettings[K],
  ) => setForm((f) => ({ ...f, [k]: v }));
  const problems = validateSettings(form);
  const planChanged = current != null && current.planType !== form.planType;

  const save = useMutation({
    mutationFn: () => saveBillingSettings(clinic.clinicId, form),
    onSuccess: () => {
      toast.success(`Billing settings saved for ${clinic.clinicName}`);
      queryClient.invalidateQueries({ queryKey: ["billing"] });
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not save"),
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-white border-l shadow-xl h-full overflow-y-auto p-6">
        <p className="text-[10px] tracking-wider text-muted-foreground">
          BILLING SETTINGS
        </p>
        <h2 className="font-semibold text-lg mt-1">{clinic.clinicName}</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Clinic ID {clinic.clinicId} · registered as a{" "}
          <span className="capitalize">{clinic.type}</span> clinic
          {current ? "" : " · not set up yet, so these are suggestions"}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (problems.length === 0) save.mutate();
          }}
          className="space-y-4"
        >
          <fieldset>
            <legend className="text-xs text-muted-foreground mb-1">Plan</legend>
            <div className="space-y-2">
              {PLAN_OPTIONS.map((p) => (
                <label
                  key={p.value}
                  className={`flex gap-2 rounded-md border p-3 cursor-pointer ${form.planType === p.value ? "border-[oklch(0.55_0.18_245)] bg-sky-50/50" : ""}`}
                >
                  <input
                    type="radio"
                    name="plan"
                    checked={form.planType === p.value}
                    onChange={() => set("planType", p.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {planChanged && (
              <p className="mt-2 text-xs text-amber-800">
                Changing the plan affects invoices drafted from now on. Invoices
                already drafted or issued keep the old plan.
              </p>
            )}
          </fieldset>

          {form.planType === "pilot" && (
            <Field label="Pilot end date">
              <input
                type="date"
                value={form.pilotEndDate ?? ""}
                onChange={(e) => set("pilotEndDate", e.target.value || null)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </Field>
          )}

          <Field label="Bill to (name)">
            <input
              value={form.billToName}
              onChange={(e) => set("billToName", e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Bill-to address">
            <textarea
              value={form.billToAddress}
              onChange={(e) => set("billToAddress", e.target.value)}
              rows={3}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Purchase order (PO) number">
            <input
              value={form.poNumber}
              onChange={(e) => set("poNumber", e.target.value)}
              placeholder={form.planType === "public" ? "From the department" : "Optional"}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Billing contact email">
            <input
              type="email"
              value={form.billingEmail}
              onChange={(e) => set("billingEmail", e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Billing start date (first billable day)">
            <input
              type="date"
              value={form.billingStartDate ?? ""}
              onChange={(e) => set("billingStartDate", e.target.value || null)}
              className="w-full border rounded-md px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Leave empty if the clinic was already live before the months you
              are billing.
            </p>
          </Field>

          {problems.length > 0 && (
            <ul className="text-xs text-red-700 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

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
              disabled={save.isPending || problems.length > 0}
              className="flex-1 bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-sm disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>
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
