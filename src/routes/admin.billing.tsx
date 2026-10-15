import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, Receipt } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { InvoiceStatusBadge } from "@/components/InvoiceDocument";
import { useCurrentAdmin } from "@/lib/auth";
import { listClinics } from "@/lib/clinic-data";
import {
  countActivePatients,
  getBillingSettings,
  listClinicInvoices,
} from "@/lib/billing-service";
import {
  activeDaysInMonth,
  calculateInvoice,
  currentBillingMonth,
  formatCents,
  formatCount,
  formatDate,
  monthLabel,
} from "@/lib/billing";
import { BILLING_CONFIG } from "@/config/billing";

// ---------------------------------------------------------------------------
// Clinic admin: their OWN clinic's billing, read-only. The clinic comes from
// the admin's profile (useCurrentAdmin), never from the address bar, so there
// is no way to point this page at another clinic. Drafts are never shown —
// only invoices that have been issued.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/admin/billing")({
  component: AdminBilling,
});

const PLAN_TEXT = {
  public: () =>
    `Public clinic: ${formatCents(BILLING_CONFIG.public.perActivePatientCents)} per active patient per month`,
  private: () => "Private clinic: monthly subscription by number of active patients",
  pilot: () => "Pilot: no charge during the pilot",
} as const;

function AdminBilling() {
  const { admin, loading: adminLoading } = useCurrentAdmin();
  const clinicId = admin?.clinicId ?? null;
  const thisMonth = currentBillingMonth();

  const settingsQ = useQuery({
    queryKey: ["billing", "settings", clinicId],
    queryFn: () => getBillingSettings(clinicId!),
    enabled: clinicId != null,
  });
  const invoicesQ = useQuery({
    queryKey: ["billing", "invoices", clinicId],
    queryFn: () => listClinicInvoices(clinicId!),
    enabled: clinicId != null,
  });
  const clinicsQ = useQuery({ queryKey: ["clinics"], queryFn: listClinics });
  const clinic = clinicsQ.data?.find((c) => c.clinicId === clinicId);

  // Counting reads every dispense, appointment and check-in this month, so
  // it runs when asked rather than every time the page opens.
  const estimate = useMutation({
    mutationFn: async () => {
      const s = settingsQ.data;
      if (clinicId == null || !s) throw new Error("Billing isn't set up yet");
      const { activePatients, countSources } = await countActivePatients(
        clinicId,
        thisMonth,
      );
      const calc = calculateInvoice({
        month: thisMonth,
        planType: s.planType,
        activePatients,
        activeDays: activeDaysInMonth(thisMonth, {
          billingStartDate: s.billingStartDate,
          deactivatedOn: clinic?.deactivatedOn ?? null,
          reactivatedOn: clinic?.reactivatedOn ?? null,
        }),
        pilotEndDate: s.pilotEndDate,
        countSources,
        countedAt: new Date().toISOString(),
      });
      return {
        activePatients,
        amountCents: calc.ok ? calc.totalCents : null,
        note: calc.ok ? null : "The amount can't be estimated yet. Zennith will confirm it on your invoice.",
      };
    },
  });

  const settings = settingsQ.data;
  const invoices = invoicesQ.data ?? [];
  const error = settingsQ.error ?? invoicesQ.error;

  return (
    <AppShell
      role="admin"
      title="Billing"
      clinicNameOverride={admin?.clinicName}
    >
      {!adminLoading && clinicId == null && (
        <p className="text-sm text-muted-foreground">
          Your account isn't linked to a clinic, so there is no billing to show.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load billing:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </p>
      )}

      {clinicId != null && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Current plan */}
            <div className="bg-white rounded-xl border p-5">
              <p className="text-[11px] tracking-wider text-muted-foreground">
                CURRENT PLAN
              </p>
              {settingsQ.isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
              ) : !settings ? (
                <p className="mt-2 text-sm">
                  Billing hasn't been set up for {admin?.clinicName ?? "your clinic"} yet.
                  Zennith will contact you before anything is invoiced.
                </p>
              ) : (
                <div className="mt-2 text-sm space-y-1">
                  <p className="font-semibold">{PLAN_TEXT[settings.planType]()}</p>
                  {settings.planType === "pilot" && (
                    <p>
                      Pilot ends{" "}
                      {settings.pilotEndDate ? formatDate(settings.pilotEndDate) : "on a date still to be set"}
                      . You'll still get a monthly R0.00 invoice so your usage is on record.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    Invoices go to {settings.billToName}
                    {settings.billingEmail ? ` (${settings.billingEmail})` : ""}
                    {settings.poNumber ? `, PO number ${settings.poNumber}` : ""}.
                  </p>
                  <p className="text-muted-foreground">
                    Payment terms: {BILLING_CONFIG[settings.planType].paymentTermsDays} days from the invoice date, by EFT.
                  </p>
                </div>
              )}
            </div>

            {/* This month so far */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] tracking-wider text-muted-foreground">
                  {monthLabel(thisMonth).toUpperCase()} SO FAR · ESTIMATE
                </p>
                <button
                  onClick={() => estimate.mutate()}
                  disabled={!settings || estimate.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-50"
                >
                  <Calculator size={12} />
                  {estimate.isPending ? "Counting…" : estimate.data ? "Count again" : "Count now"}
                </button>
              </div>
              {estimate.error ? (
                <p className="mt-2 text-sm text-red-700">
                  {estimate.error instanceof Error ? estimate.error.message : "Count failed"}
                </p>
              ) : estimate.data ? (
                <div className="mt-2">
                  <p className="text-3xl font-bold">
                    {formatCount(estimate.data.activePatients)}
                    <span className="text-sm font-normal text-muted-foreground"> active patients</span>
                  </p>
                  <p className="text-sm mt-1">
                    {estimate.data.amountCents != null
                      ? <>Estimated amount: <strong>≈ {formatCents(estimate.data.amountCents)}</strong></>
                      : estimate.data.note}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Press "Count now" to see how many patients have been active this month.
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                This is an estimate only, not an invoice. The month isn't over,
                so the count will still change. An active patient is anyone with
                at least one visit, medicine dispense or appointment at your
                clinic in the month (cancelled and missed appointments don't count).
              </p>
            </div>
          </div>

          {/* Invoice history */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="p-5 border-b flex items-center gap-3">
              <Receipt size={16} />
              <h3 className="font-semibold">Invoices</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium">Invoice no.</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="px-5 py-3">{monthLabel(i.billingMonth)}</td>
                    <td className="px-5 py-3 font-medium">{i.invoiceNumber}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {i.dueDate ? formatDate(i.dueDate) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatCents(i.totalCents)}
                    </td>
                    <td className="px-5 py-3">
                      <InvoiceStatusBadge invoice={i} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to="/admin/billing/$invoiceId"
                        params={{ invoiceId: i.id }}
                        className="text-xs border px-2 py-1 rounded hover:bg-secondary"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
                {!invoicesQ.isLoading && invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No invoices yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
