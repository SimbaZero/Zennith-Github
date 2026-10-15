import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { useCurrentAdmin } from "@/lib/auth";
import { getInvoice } from "@/lib/billing-service";

// ---------------------------------------------------------------------------
// Clinic admin: one of their own clinic's invoices, read-only and printable.
//
// Only the invoice id comes from the address bar. The clinic is ALWAYS the
// admin's own (from their profile), and the invoice is looked up inside that
// clinic only — so typing another clinic's invoice id finds nothing. Drafts
// are refused here too; the Firestore rules refuse them as well.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/admin/billing_/$invoiceId")({
  component: AdminInvoicePage,
});

function AdminInvoicePage() {
  const { invoiceId } = Route.useParams();
  const { admin, loading: adminLoading } = useCurrentAdmin();
  const clinicId = admin?.clinicId ?? null;

  const { data: invoice, isLoading } = useQuery({
    queryKey: ["invoice", clinicId, invoiceId],
    // A refusal from the rules (e.g. a draft) is shown the same as "not
    // found": the admin learns nothing about an invoice they can't see.
    queryFn: () => getInvoice(clinicId!, invoiceId).catch(() => null),
    enabled: clinicId != null,
  });
  const visible = invoice && invoice.status !== "draft" ? invoice : null;

  return (
    <AppShell role="admin" title="Invoice" clinicNameOverride={admin?.clinicName}>
      <div className="print:hidden mb-4 flex items-center gap-2">
        <Link
          to="/admin/billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Billing
        </Link>
        {visible && (
          <button
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <Printer size={14} /> Print / Save as PDF
          </button>
        )}
      </div>

      {(adminLoading || isLoading) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {!adminLoading && !isLoading && !visible && (
        <p className="text-sm text-muted-foreground">
          Invoice not found. It may belong to a different clinic, or not have
          been issued yet.
        </p>
      )}
      {visible && <InvoiceDocument invoice={visible} />}
    </AppShell>
  );
}
