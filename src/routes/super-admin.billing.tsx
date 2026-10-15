import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  FilePlus2,
  Hourglass,
  Receipt,
  Send,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BillingSettingsDrawer } from "@/components/BillingSettingsDrawer";
import {
  InvoiceStatusBadge,
  VatSwitchWarning,
} from "@/components/InvoiceDocument";
import { listClinics, type ClinicRecord } from "@/lib/clinic-data";
import {
  countActivePatients,
  generateDraftsForMonth,
  getAllBillingSettings,
  issueAllDrafts,
  issueInvoice,
  listAllInvoices,
  type DraftResult,
} from "@/lib/billing-service";
import {
  activeDaysInMonth,
  calculateInvoice,
  currentBillingMonth,
  displayStatus,
  formatCents,
  formatCount,
  isOverdue,
  monthLabel,
  previousMonth,
  type ClinicBillingSettings,
  type Invoice,
} from "@/lib/billing";

export const Route = createFileRoute("/super-admin/billing")({
  component: SuperAdminBilling,
});

type PlanFilter = "all" | "public" | "private" | "pilot" | "none";
type StatusFilter = "all" | "draft" | "issued" | "overdue" | "paid" | "void" | "none";
type ClinicFilter = "all" | "active" | "deactivated";

/** Live count for the current month — only when asked, never on page load. */
type Estimate =
  | { state: "counting" }
  | { state: "done"; activePatients: number; amountCents: number | null; note?: string }
  | { state: "error"; message: string };

function SuperAdminBilling() {
  const queryClient = useQueryClient();
  const thisMonth = currentBillingMonth();

  const clinicsQ = useQuery({ queryKey: ["clinics"], queryFn: listClinics });
  const settingsQ = useQuery({
    queryKey: ["billing", "settings"],
    queryFn: getAllBillingSettings,
  });
  const invoicesQ = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: () => listAllInvoices(),
  });

  const clinics = (clinicsQ.data ?? []).filter((c) => c.status !== "pending");
  const settings = settingsQ.data ?? new Map<number, ClinicBillingSettings>();
  const invoices = invoicesQ.data ?? [];
  const loadError = clinicsQ.error ?? settingsQ.error ?? invoicesQ.error;

  // ---- Headline figures ----------------------------------------------------
  const stats = useMemo(() => {
    // MRR: what the most recent billed month (one with issued or paid
    // invoices) came to. Per-patient amounts move month to month, so this is
    // the last real month, not a forecast.
    const billed = invoices.filter(
      (i) => i.status === "issued" || i.status === "paid",
    );
    const mrrMonth = billed.map((i) => i.billingMonth).sort().pop() ?? null;
    const mrr = billed
      .filter((i) => i.billingMonth === mrrMonth)
      .reduce((s, i) => s + i.totalCents, 0);
    const unpaid = invoices.filter((i) => i.status === "issued");
    const overdue = unpaid.filter((i) => isOverdue(i));
    return {
      mrrMonth,
      mrr,
      outstanding: unpaid.reduce((s, i) => s + i.totalCents, 0),
      outstandingCount: unpaid.length,
      overdue: overdue.reduce((s, i) => s + i.totalCents, 0),
      overdueCount: overdue.length,
    };
  }, [invoices]);

  // Latest invoice per clinic (newest month; within a month, not-void first).
  const latestByClinic = useMemo(() => {
    const m = new Map<number, Invoice>();
    for (const i of invoices) {
      const cur = m.get(i.clinicId);
      if (
        !cur ||
        i.billingMonth > cur.billingMonth ||
        (i.billingMonth === cur.billingMonth && cur.status === "void" && i.status !== "void")
      )
        m.set(i.clinicId, i);
    }
    return m;
  }, [invoices]);

  // ---- This month's estimate (on demand) ---------------------------------
  const [estimates, setEstimates] = useState<Map<number, Estimate>>(new Map());
  const [counting, setCounting] = useState(false);
  const countAll = async () => {
    setCounting(true);
    const targets = clinics.filter(
      (c) => c.status === "active" && settings.has(c.clinicId),
    );
    for (const c of targets) {
      setEstimates((prev) => new Map(prev).set(c.clinicId, { state: "counting" }));
      let est: Estimate;
      try {
        const s = settings.get(c.clinicId)!;
        const { activePatients, countSources } = await countActivePatients(
          c.clinicId,
          thisMonth,
        );
        const calc = calculateInvoice({
          month: thisMonth,
          planType: s.planType,
          activePatients,
          activeDays: activeDaysInMonth(thisMonth, {
            billingStartDate: s.billingStartDate,
            deactivatedOn: c.deactivatedOn ?? null,
            reactivatedOn: c.reactivatedOn ?? null,
          }),
          pilotEndDate: s.pilotEndDate,
          countSources,
          countedAt: new Date().toISOString(),
        });
        est = calc.ok
          ? { state: "done", activePatients, amountCents: calc.totalCents }
          : { state: "done", activePatients, amountCents: null, note: calc.error };
      } catch (err) {
        est = {
          state: "error",
          message: err instanceof Error ? err.message : "Count failed",
        };
      }
      setEstimates((prev) => new Map(prev).set(c.clinicId, est));
    }
    setCounting(false);
  };

  // ---- Filters -----------------------------------------------------------
  const [planF, setPlanF] = useState<PlanFilter>("all");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [clinicF, setClinicF] = useState<ClinicFilter>("all");
  const rows = clinics
    .filter((c) => clinicF === "all" || c.status === clinicF)
    .filter((c) => {
      if (planF === "all") return true;
      const p = settings.get(c.clinicId)?.planType;
      return planF === "none" ? !p : p === planF;
    })
    .filter((c) => {
      if (statusF === "all") return true;
      const inv = latestByClinic.get(c.clinicId);
      return statusF === "none" ? !inv : !!inv && displayStatus(inv) === statusF;
    });

  // ---- Generate and issue --------------------------------------------------
  const [genMonth, setGenMonth] = useState(previousMonth(thisMonth));
  const [results, setResults] = useState<DraftResult[] | null>(null);
  const [confirmGen, setConfirmGen] = useState(false);
  const [confirmIssueAll, setConfirmIssueAll] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["billing"] });

  const generate = useMutation({
    mutationFn: () => generateDraftsForMonth(genMonth),
    onSuccess: (r) => {
      setResults(r);
      setConfirmGen(false);
      const made = r.filter((x) => x.ok).length;
      toast.success(`${made} draft${made === 1 ? "" : "s"} created for ${monthLabel(genMonth)}`);
      refresh();
    },
    onError: (err) => {
      setConfirmGen(false);
      toast.error(err instanceof Error ? err.message : "Could not generate drafts");
    },
  });

  const monthInvoices = invoices.filter((i) => i.billingMonth === genMonth);
  const monthDrafts = monthInvoices.filter((i) => i.status === "draft");

  const issueAll = useMutation({
    mutationFn: () => issueAllDrafts(genMonth),
    onSuccess: (r) => {
      setConfirmIssueAll(false);
      const ok = r.filter((x) => x.ok);
      const bad = r.filter((x) => !x.ok);
      if (ok.length)
        toast.success(
          `Issued ${ok.length}: ${ok[0].result}${ok.length > 1 ? ` to ${ok[ok.length - 1].result}` : ""}`,
        );
      for (const b of bad) toast.error(`${b.clinicName}: ${b.result}`);
      refresh();
    },
    onError: (err) => {
      setConfirmIssueAll(false);
      toast.error(err instanceof Error ? err.message : "Could not issue drafts");
    },
  });

  const issueOne = useMutation({
    mutationFn: (i: Invoice) => issueInvoice(i.clinicId, i.id),
    onSuccess: (n) => {
      toast.success(`Issued as ${n}`);
      refresh();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not issue"),
  });

  // ---- Settings drawer -----------------------------------------------------
  const [editing, setEditing] = useState<ClinicRecord | null>(null);

  const loading = clinicsQ.isLoading || settingsQ.isLoading || invoicesQ.isLoading;

  return (
    <AppShell role="super_admin" title="Billing">
      <VatSwitchWarning />
      {loadError && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load billing data:{" "}
          {loadError instanceof Error ? loadError.message : "unknown error"}.
          If this says "missing or insufficient permissions", the billing
          Firestore rules haven't been applied yet. If it mentions an index,
          follow the link in the browser console to create it.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          icon={Banknote}
          label="MONTHLY RECURRING REVENUE"
          value={loading ? "-" : formatCents(stats.mrr)}
          sub={
            stats.mrrMonth
              ? `${monthLabel(stats.mrrMonth)} invoices (issued and paid)`
              : "No invoices issued yet"
          }
        />
        <Stat
          icon={Hourglass}
          label="OUTSTANDING"
          value={loading ? "-" : formatCents(stats.outstanding)}
          sub={`${stats.outstandingCount} issued, not yet paid`}
        />
        <Stat
          icon={AlertTriangle}
          label="OVERDUE"
          value={loading ? "-" : formatCents(stats.overdue)}
          sub={`${stats.overdueCount} past their due date`}
          warn={stats.overdueCount > 0}
        />
      </div>

      {/* Generate and issue for a month */}
      <div className="bg-white rounded-xl border mb-6">
        <div className="p-5 border-b flex flex-wrap items-center gap-3">
          <FilePlus2 size={16} />
          <h3 className="font-semibold">Invoices for a month</h3>
          <input
            type="month"
            value={genMonth}
            max={thisMonth}
            onChange={(e) => {
              setGenMonth(e.target.value);
              setResults(null);
            }}
            className="border rounded-md px-2 py-1 text-sm"
            aria-label="Billing month"
          />
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              onClick={() => setConfirmGen(true)}
              disabled={!genMonth || generate.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            >
              <FilePlus2 size={14} />
              {generate.isPending
                ? "Generating…"
                : `Generate invoices for ${genMonth ? monthLabel(genMonth) : "…"}`}
            </button>
            <button
              onClick={() => setConfirmIssueAll(true)}
              disabled={monthDrafts.length === 0 || issueAll.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              <Send size={14} />
              {issueAll.isPending
                ? "Issuing…"
                : `Issue all ${monthDrafts.length} draft${monthDrafts.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>

        {genMonth === thisMonth && (
          <p className="px-5 pt-4 text-xs text-amber-800">
            {monthLabel(thisMonth)} isn't over yet. Drafts made now only count
            patients seen so far this month.
          </p>
        )}

        {results && (
          <div className="px-5 pt-4 text-sm">
            <p className="font-medium mb-1">
              Generation result for {monthLabel(genMonth)}
            </p>
            <ul className="space-y-0.5">
              {results.map((r) => (
                <li key={r.clinicId} className={r.ok ? "text-emerald-800" : "text-muted-foreground"}>
                  {r.ok ? "Draft created" : "Skipped"}: {r.clinicName}
                  {!r.ok && ` (${r.reason})`}
                </li>
              ))}
            </ul>
          </div>
        )}

        <table className="w-full text-sm mt-2">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-5 py-3 font-medium">Clinic</th>
              <th className="px-5 py-3 font-medium">Invoice no.</th>
              <th className="px-5 py-3 font-medium text-right">Active patients</th>
              <th className="px-5 py-3 font-medium text-right">Total</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {monthInvoices
              .slice()
              .sort((a, b) => a.clinicName.localeCompare(b.clinicName))
              .map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-5 py-3 font-medium">{i.clinicName}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {i.invoiceNumber ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatCount(i.snapshot.activePatients)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatCents(i.totalCents)}
                  </td>
                  <td className="px-5 py-3">
                    <InvoiceStatusBadge invoice={i} />
                  </td>
                  <td className="px-5 py-3 text-right space-x-1 whitespace-nowrap">
                    {i.status === "draft" && (
                      <button
                        onClick={() => issueOne.mutate(i)}
                        disabled={issueOne.isPending}
                        className="text-xs border px-2 py-1 rounded hover:bg-secondary disabled:opacity-50"
                      >
                        Issue
                      </button>
                    )}
                    <Link
                      to="/super-admin/billing/$clinicId/$invoiceId"
                      params={{ clinicId: String(i.clinicId), invoiceId: i.id }}
                      className="text-xs border px-2 py-1 rounded hover:bg-secondary inline-block"
                    >
                      {i.status === "draft" ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            {!loading && monthInvoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                  No invoices for {genMonth ? monthLabel(genMonth) : "this month"} yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* All clinics */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex flex-wrap items-center gap-3">
          <Receipt size={16} />
          <h3 className="font-semibold">Clinics</h3>
          <Select
            label="Plan"
            value={planF}
            onChange={(v) => setPlanF(v as PlanFilter)}
            options={[
              ["all", "All plans"],
              ["public", "Public"],
              ["private", "Private"],
              ["pilot", "Pilot"],
              ["none", "Not set up"],
            ]}
          />
          <Select
            label="Latest invoice"
            value={statusF}
            onChange={(v) => setStatusF(v as StatusFilter)}
            options={[
              ["all", "Any status"],
              ["draft", "Draft"],
              ["issued", "Issued"],
              ["overdue", "Overdue"],
              ["paid", "Paid"],
              ["void", "Void"],
              ["none", "No invoices"],
            ]}
          />
          <Select
            label="Clinic"
            value={clinicF}
            onChange={(v) => setClinicF(v as ClinicFilter)}
            options={[
              ["all", "Active and deactivated"],
              ["active", "Active"],
              ["deactivated", "Deactivated"],
            ]}
          />
          <button
            onClick={countAll}
            disabled={counting || loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            title="Reads this month's dispenses, appointments and check-ins for every active clinic. Counts only."
          >
            <Calculator size={14} />
            {counting ? "Counting…" : `Count ${monthLabel(thisMonth)} so far`}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-5 py-3 font-medium">Clinic</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium text-right">
                Active patients, {monthLabel(thisMonth)}
              </th>
              <th className="px-5 py-3 font-medium text-right">
                Estimated amount
              </th>
              <th className="px-5 py-3 font-medium">Latest invoice</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = settings.get(c.clinicId);
              const est = estimates.get(c.clinicId);
              const latest = latestByClinic.get(c.clinicId);
              return (
                <tr key={c.clinicId} className="border-b last:border-0">
                  <td className="px-5 py-3">
                    <span className="font-medium">{c.clinicName}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      ID {c.clinicId} · <span className="capitalize">{c.type}</span>
                      {c.status === "deactivated" && (
                        <span className="text-red-700"> · deactivated</span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {s ? (
                      <span className="capitalize">{s.planType}</span>
                    ) : (
                      <span className="text-amber-700">Not set up</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {!est
                      ? "—"
                      : est.state === "counting"
                        ? "…"
                        : est.state === "error"
                          ? <span className="text-red-700 text-xs">{est.message}</span>
                          : formatCount(est.activePatients)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {est?.state === "done"
                      ? est.amountCents != null
                        ? <span title="Estimate: the month isn't over">≈ {formatCents(est.amountCents)}</span>
                        : <span className="text-xs text-amber-700">{est.note}</span>
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {latest ? (
                      <Link
                        to="/super-admin/billing/$clinicId/$invoiceId"
                        params={{ clinicId: String(c.clinicId), invoiceId: latest.id }}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <span className="text-xs text-muted-foreground">
                          {monthLabel(latest.billingMonth)}
                        </span>
                        <InvoiceStatusBadge invoice={latest} />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setEditing(c)}
                      className="text-xs border px-2 py-1 rounded hover:bg-secondary"
                    >
                      {s ? "Settings" : "Set up billing"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                  No clinics match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11px] text-muted-foreground border-t">
          Active patients and amounts for {monthLabel(thisMonth)} are estimates,
          counted only when you press the count button, because counting reads
          every dispense, appointment and check-in for the month. Amounts on
          invoices use the count saved when the draft was generated.
        </p>
      </div>

      <ConfirmDialog
        open={confirmGen}
        busy={generate.isPending}
        title={`Generate invoices for ${genMonth ? monthLabel(genMonth) : ""}?`}
        description={
          "This creates a draft for every clinic that was active that month and has billing set up. " +
          "Clinics that already have a non-void invoice for the month are skipped. " +
          "Drafts have no number and can be checked and discarded before issuing. " +
          "Counting can take a while for many clinics."
        }
        confirmLabel="Generate drafts"
        onCancel={() => setConfirmGen(false)}
        onConfirm={() => generate.mutate()}
      />
      <ConfirmDialog
        open={confirmIssueAll}
        busy={issueAll.isPending}
        title={`Issue all ${monthDrafts.length} drafts for ${genMonth ? monthLabel(genMonth) : ""}?`}
        description={
          "Each gets the next invoice number and today's date, in clinic-name order, and can't be edited afterwards. " +
          "Have you reviewed them?"
        }
        confirmLabel="Issue all"
        onCancel={() => setConfirmIssueAll(false)}
        onConfirm={() => issueAll.mutate()}
      />

      {editing && (
        <BillingSettingsDrawer
          clinic={editing}
          current={settings.get(editing.clinicId) ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${warn ? "border-red-300" : ""}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <p className="text-[11px] tracking-wider">{label}</p>
      </div>
      <p className={`text-3xl font-bold mt-1 ${warn ? "text-red-700" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="border rounded-md px-2 py-1 text-sm bg-white"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
