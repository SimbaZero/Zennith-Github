import { BILLING_CONFIG } from "@/config/billing";
import {
  displayStatus,
  formatCents,
  formatDate,
  monthLabel,
  type Invoice,
} from "@/lib/billing";

// ---------------------------------------------------------------------------
// The invoice itself, as it prints. Shared by the Super Admin and clinic admin
// invoice pages. Everything comes from the invoice's own saved copy (its
// supplier, bill-to and price snapshot), never from today's config, so an
// issued invoice looks the same forever.
//
// Counts only: the line items say how many active patients, never who.
//
// While VAT is off this is an "Invoice" with no VAT line, and never a
// "Tax Invoice" — Zennith is not a VAT vendor.
// ---------------------------------------------------------------------------

const PLAN_LABEL = {
  public: "Public clinic, per active patient",
  private: "Private clinic, monthly subscription",
  pilot: "Pilot clinic, no charge",
} as const;

export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const status = displayStatus(invoice);
  const s = invoice.supplier;
  const vatShown = invoice.snapshot?.vatEnabled;

  return (
    <div className="invoice-sheet relative mx-auto max-w-[210mm] bg-white text-[13px] leading-relaxed text-neutral-900 border shadow-sm p-10">
      {status === "draft" && (
        <Stamp className="text-amber-600 border-amber-600">
          DRAFT · NOT ISSUED
        </Stamp>
      )}
      {status === "void" && (
        <Stamp className="text-red-600 border-red-600">VOID</Stamp>
      )}
      {status === "paid" && (
        <Stamp className="text-emerald-700 border-emerald-700">PAID</Stamp>
      )}

      {/* Supplier and title */}
      <div className="flex items-start justify-between gap-6 border-b pb-6">
        <div>
          <p className="text-lg font-semibold">{s.entityName}</p>
          <p className="whitespace-pre-line text-neutral-600">{s.address}</p>
          <p className="text-neutral-600">Registration no. {s.registrationNumber}</p>
          <p className="text-neutral-600">CSD no. {s.csdNumber}</p>
          <p className="text-neutral-600">{s.billingEmail}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-wide">INVOICE</p>
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 text-left">
            <dt className="text-neutral-500">Invoice no.</dt>
            <dd className="font-medium">
              {invoice.invoiceNumber ?? "Not yet issued"}
            </dd>
            <dt className="text-neutral-500">Issue date</dt>
            <dd>{invoice.issueDate ? formatDate(invoice.issueDate) : "—"}</dd>
            <dt className="text-neutral-500">Due date</dt>
            <dd>{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</dd>
            <dt className="text-neutral-500">Billing month</dt>
            <dd>{monthLabel(invoice.billingMonth)}</dd>
          </dl>
        </div>
      </div>

      {/* Bill-to */}
      <div className="invoice-keep grid grid-cols-2 gap-6 py-6 border-b">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
            Bill to
          </p>
          <p className="font-medium">{invoice.billTo.name}</p>
          {invoice.billTo.address && (
            <p className="whitespace-pre-line">{invoice.billTo.address}</p>
          )}
          {invoice.billTo.email && <p>{invoice.billTo.email}</p>}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
            For services to
          </p>
          <p className="font-medium">{invoice.clinicName}</p>
          <p>Clinic ID {invoice.clinicId}</p>
          <p>{PLAN_LABEL[invoice.snapshot.planType]}</p>
          <p className="mt-2">
            <span className="text-neutral-500">Purchase order (PO) no.: </span>
            {invoice.billTo.poNumber || "—"}
          </p>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full mt-6">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wider text-neutral-500">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 font-medium text-right w-32">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((l, i) => (
            <tr key={i} className="border-b align-top">
              <td className="py-3 pr-4">{l.description}</td>
              <td className="py-3 text-right tabular-nums">
                {formatCents(l.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="invoice-keep ml-auto mt-4 w-72">
        <Row label="Subtotal" value={formatCents(invoice.subtotalCents)} />
        {vatShown && (
          <Row
            label={`VAT at ${invoice.snapshot.vatRatePercent}%`}
            value={formatCents(invoice.vatCents)}
          />
        )}
        <div className="flex justify-between border-t-2 border-neutral-900 pt-2 mt-1 text-base font-bold">
          <span>Total due</span>
          <span className="tabular-nums">{formatCents(invoice.totalCents)}</span>
        </div>
      </div>

      {/* Status notes */}
      {invoice.status === "paid" && (
        <p className="invoice-keep mt-6 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-900">
          Paid on {invoice.paidDate ? formatDate(invoice.paidDate) : "—"} by
          EFT, reference {invoice.paymentReference}.
        </p>
      )}
      {invoice.status === "void" && (
        <p className="invoice-keep mt-6 rounded border border-red-200 bg-red-50 px-4 py-2 text-red-900">
          This invoice was voided
          {invoice.voidedAt ? ` on ${formatDate(invoice.voidedAt.slice(0, 10))}` : ""}
          . Reason: {invoice.voidReason}. Do not pay it.
        </p>
      )}

      {/* Payment terms and banking */}
      <div className="invoice-keep mt-8 border-t pt-6 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
            Payment terms
          </p>
          <p>
            Payment due within {invoice.snapshot.paymentTermsDays} days of the
            issue date, by electronic funds transfer (EFT).
          </p>
          <p>
            Please use the invoice number
            {invoice.invoiceNumber ? ` ${invoice.invoiceNumber}` : ""} as your
            payment reference.
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">
            Banking details
          </p>
          <p className="whitespace-pre-line">{s.bankingDetails}</p>
        </div>
      </div>

      <p className="mt-8 text-[11px] text-neutral-500">
        {vatShown
          ? null
          : `${s.entityName} is not registered for VAT. No VAT is charged on this invoice.`}
        {invoice.snapshot.planType !== "pilot" &&
          ` Active patients are patients who had at least one visit, medicine dispense or appointment at this clinic in ${monthLabel(invoice.billingMonth)}.`}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-neutral-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Stamp({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`pointer-events-none absolute right-10 top-36 rotate-[-12deg] rounded border-4 px-4 py-1 text-2xl font-black tracking-widest opacity-60 ${className}`}
    >
      {children}
    </div>
  );
}

const BADGE: Record<ReturnType<typeof displayStatus>, string> = {
  draft: "bg-amber-50 text-amber-800 border-amber-200",
  issued: "bg-sky-50 text-sky-800 border-sky-200",
  overdue: "bg-red-50 text-red-800 border-red-200",
  paid: "bg-emerald-50 text-emerald-800 border-emerald-200",
  void: "bg-neutral-100 text-neutral-600 border-neutral-200 line-through",
};

/** Status pill; "overdue" is worked out from the due date, never stored. */
export function InvoiceStatusBadge({
  invoice,
}: {
  invoice: Pick<Invoice, "status" | "dueDate">;
}) {
  const s = displayStatus(invoice);
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${BADGE[s]}`}
    >
      {s}
    </span>
  );
}

/**
 * Shown on screen (never printed) when the VAT switch is on: what a valid
 * South African tax invoice needs, which this invoice does not yet supply.
 */
export function VatSwitchWarning() {
  if (!BILLING_CONFIG.vat.enabled) return null;
  return (
    <div className="print:hidden mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">
        VAT is switched on, but these invoices are not yet valid tax invoices.
      </p>
      <p className="mt-1">
        Under section 20 of the VAT Act, a full tax invoice also needs (check
        with your accountant or SARS before relying on this):
      </p>
      <ul className="mt-1 list-disc pl-5">
        <li>The words "Tax Invoice" in a prominent place</li>
        <li>Zennith's VAT registration number</li>
        <li>
          The customer's VAT registration number, if they are a VAT vendor, and
          their name and address
        </li>
        <li>A serial number and the date of issue (these exist already)</li>
        <li>
          A full description of the service, the quantity, the value, the VAT
          charged and the total, or a statement that the total includes VAT at
          15%
        </li>
      </ul>
      <p className="mt-1">
        Zennith must also actually be registered as a VAT vendor before
        charging VAT.
      </p>
    </div>
  );
}
