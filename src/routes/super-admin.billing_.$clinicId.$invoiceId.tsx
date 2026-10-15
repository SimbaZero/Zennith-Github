import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Printer } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  InvoiceDocument,
  InvoiceStatusBadge,
  VatSwitchWarning,
} from "@/components/InvoiceDocument";
import {
  createDraftInvoice,
  discardDraft,
  getInvoice,
  issueInvoice,
  markInvoicePaid,
  voidInvoice,
} from "@/lib/billing-service";
import { listClinics } from "@/lib/clinic-data";
import {
  formatCount,
  formatDate,
  monthLabel,
  todayInClinicTime,
} from "@/lib/billing";

export const Route = createFileRoute("/super-admin/billing_/$clinicId/$invoiceId")({
  component: SuperAdminInvoicePage,
});

type Action = "issue" | "discard" | "paid" | "void" | "replace" | null;

function SuperAdminInvoicePage() {
  const { clinicId: clinicParam, invoiceId } = Route.useParams();
  const clinicId = Number(clinicParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ["invoice", clinicId, invoiceId];
  const { data: invoice, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => getInvoice(clinicId, invoiceId),
    enabled: Number.isFinite(clinicId),
  });

  const [action, setAction] = useState<Action>(null);
  const [paidDate, setPaidDate] = useState(todayInClinicTime());
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["billing"] });
  };
  const close = () => {
    setAction(null);
    setReference("");
    setReason("");
  };

  const run = useMutation({
    mutationFn: async (a: Exclude<Action, null>) => {
      switch (a) {
        case "issue":
          return `Issued as ${await issueInvoice(clinicId, invoiceId)}`;
        case "discard":
          await discardDraft(clinicId, invoiceId);
          return "Draft discarded";
        case "paid":
          await markInvoicePaid(clinicId, invoiceId, paidDate, reference);
          return "Marked as paid";
        case "void":
          await voidInvoice(clinicId, invoiceId, reason);
          return "Invoice voided";
        case "replace": {
          const clinic = (await listClinics()).find(
            (c) => c.clinicId === clinicId,
          );
          if (!clinic || !invoice) throw new Error("Clinic not found");
          const r = await createDraftInvoice(clinic, invoice.billingMonth);
          if (!r.ok) throw new Error(r.reason);
          return `new:${r.invoiceId}`;
        }
      }
    },
    onSuccess: (msg, a) => {
      close();
      refresh();
      if (a === "discard") {
        toast.success(msg);
        navigate({ to: "/super-admin/billing" });
      } else if (msg.startsWith("new:")) {
        toast.success("Replacement draft created. Check it, then issue it.");
        navigate({
          to: "/super-admin/billing/$clinicId/$invoiceId",
          params: { clinicId: String(clinicId), invoiceId: msg.slice(4) },
        });
      } else {
        toast.success(msg);
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "That didn't work"),
  });

  return (
    <AppShell role="super_admin" title="Invoice">
      <div className="print:hidden mb-4 flex flex-wrap items-center gap-2">
        <Link
          to="/super-admin/billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Billing
        </Link>
        {invoice && (
          <>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-sm font-medium">
              {invoice.clinicName}, {monthLabel(invoice.billingMonth)}
            </span>
            <InvoiceStatusBadge invoice={invoice} />
            <div className="ml-auto flex flex-wrap gap-2">
              {invoice.status === "draft" && (
                <>
                  <Btn onClick={() => setAction("discard")}>Discard draft</Btn>
                  <Btn primary onClick={() => setAction("issue")}>
                    Issue invoice
                  </Btn>
                </>
              )}
              {invoice.status === "issued" && (
                <Btn primary onClick={() => setAction("paid")}>
                  Mark as paid
                </Btn>
              )}
              {(invoice.status === "issued" || invoice.status === "paid") && (
                <Btn danger onClick={() => setAction("void")}>
                  Void
                </Btn>
              )}
              {invoice.status === "void" && (
                <Btn primary onClick={() => setAction("replace")}>
                  Create replacement draft
                </Btn>
              )}
              <Btn onClick={() => window.print()}>
                <Printer size={14} /> Print / Save as PDF
              </Btn>
            </div>
          </>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-sm text-red-600">
          Could not load this invoice:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </p>
      )}
      {!isLoading && !error && !invoice && (
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
      )}

      {invoice && (
        <>
          <VatSwitchWarning />
          {invoice.status === "draft" && (
            <div className="print:hidden mb-4 rounded-xl border bg-white p-4 text-sm">
              <p className="font-semibold mb-1">How this draft was worked out</p>
              <p>
                {formatCount(invoice.snapshot.activePatients)} active patients,
                counted {formatDate(invoice.snapshot.countedAt.slice(0, 10))}{" "}
                from {formatCount(invoice.snapshot.countSources.dispenses)}{" "}
                dispense records,{" "}
                {formatCount(invoice.snapshot.countSources.appointments)}{" "}
                appointments and{" "}
                {formatCount(invoice.snapshot.countSources.checkIns)} reception
                check-ins.
              </p>
              <p>
                Active {invoice.snapshot.activeDays} of{" "}
                {invoice.snapshot.daysInMonth} days. Payment terms{" "}
                {invoice.snapshot.paymentTermsDays} days from issue.
              </p>
              <p className="text-muted-foreground mt-1">
                If the plan, bill-to details or count are wrong: fix the clinic's
                billing settings, discard this draft, and generate it again.
              </p>
            </div>
          )}
          <InvoiceDocument invoice={invoice} />
        </>
      )}

      <ConfirmDialog
        open={action === "issue"}
        busy={run.isPending}
        title="Issue this invoice?"
        description={
          "It gets the next invoice number and today's date, and can never be edited again. " +
          "If it turns out to be wrong, you'll have to void it and issue a new one."
        }
        confirmLabel="Issue invoice"
        onCancel={close}
        onConfirm={() => run.mutate("issue")}
      />
      <ConfirmDialog
        open={action === "discard"}
        destructive
        busy={run.isPending}
        title="Discard this draft?"
        description="The draft has no invoice number yet, so nothing is lost. You can generate it again."
        confirmLabel="Discard draft"
        onCancel={close}
        onConfirm={() => run.mutate("discard")}
      />
      <ConfirmDialog
        open={action === "paid"}
        busy={run.isPending}
        confirmDisabled={!reference.trim() || !paidDate}
        title={`Mark ${invoice?.invoiceNumber ?? "invoice"} as paid?`}
        description="Record the EFT payment as it appears on the bank statement."
        confirmLabel="Mark as paid"
        onCancel={close}
        onConfirm={() => run.mutate("paid")}
      >
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            Payment date
            <input
              type="date"
              value={paidDate}
              max={todayInClinicTime()}
              onChange={(e) => setPaidDate(e.target.value)}
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            EFT reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="As shown on the bank statement"
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={action === "void"}
        destructive
        busy={run.isPending}
        confirmDisabled={reason.trim().length < 5}
        title={`Void ${invoice?.invoiceNumber ?? "this invoice"}?`}
        description={
          "The invoice keeps its number and stays on record, marked VOID. " +
          "The month is then free for a replacement invoice. This can't be undone."
        }
        confirmLabel="Void invoice"
        onCancel={close}
        onConfirm={() => run.mutate("void")}
      >
        <label className="block text-xs text-muted-foreground">
          Reason (required)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Wrong PO number; reissued with the correct one"
            className="mt-1 w-full border rounded-md px-3 py-2 text-sm text-foreground"
          />
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={action === "replace"}
        busy={run.isPending}
        title="Create a replacement draft?"
        description={
          "A new draft for the same clinic and month is made from the clinic's current billing settings, " +
          "with a fresh active-patient count. You can check it before issuing."
        }
        confirmLabel="Create draft"
        onCancel={close}
        onConfirm={() => run.mutate("replace")}
      />
    </AppShell>
  );
}

function Btn({
  children,
  onClick,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const style = primary
    ? "bg-[oklch(0.18_0.06_260)] text-white hover:bg-[oklch(0.25_0.08_260)] border-transparent"
    : danger
      ? "text-destructive border-destructive/30 hover:bg-destructive/10"
      : "hover:bg-secondary";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${style}`}
    >
      {children}
    </button>
  );
}
