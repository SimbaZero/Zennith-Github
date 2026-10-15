// ---------------------------------------------------------------------------
// Billing calculations — pure functions, no database access.
//
// Everything here works in whole cents. Prices come from src/config/billing.ts
// only. Kept free of Firestore so the maths can be checked on its own, and so
// the invoice screen and the draft generator always agree on an amount.
//
// Billing works on COUNTS ONLY. Nothing in this file takes or returns a
// patient's name, ID number or any patient-level detail.
// ---------------------------------------------------------------------------

import {
  BILLING_CONFIG,
  type PlanType,
  type PrivateTier,
} from "@/config/billing";

// ---- Types shared by the billing service and screens ---------------------

export type InvoiceStatus = "draft" | "issued" | "paid" | "void";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

/** Per-clinic billing settings: clinics/{clinicId}/billing/settings */
export interface ClinicBillingSettings {
  planType: PlanType;
  billToName: string;
  billToAddress: string;
  poNumber: string;
  billingEmail: string;
  /** YYYY-MM-DD. Pilot clinics only. */
  pilotEndDate: string | null;
  /** YYYY-MM-DD. First day the clinic is billable. */
  billingStartDate: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

/** Everything an invoice was built from, frozen when the draft is made. */
export interface InvoiceSnapshot {
  planType: PlanType;
  activePatients: number;
  /** How the count was reached: rows read per source, for explaining it later. */
  countSources: { dispenses: number; appointments: number; checkIns: number };
  countedAt: string;
  perActivePatientCents: number | null;
  tier: PrivateTier | null;
  tierMonthlyCents: number | null;
  tierLimits: { smallMax: number | null; mediumMax: number | null } | null;
  activeDays: number;
  daysInMonth: number;
  paymentTermsDays: number;
  pilotEndDate: string | null;
  vatEnabled: boolean;
  vatRatePercent: number;
}

/** clinics/{clinicId}/invoices/{invoiceId} */
export interface Invoice {
  id: string;
  clinicId: number;
  clinicName: string;
  /** YYYY-MM */
  billingMonth: string;
  /** Null until issued. */
  invoiceNumber: string | null;
  /** YYYY-MM-DD, set at issue. */
  issueDate: string | null;
  /** YYYY-MM-DD, set at issue. */
  dueDate: string | null;
  status: InvoiceStatus;
  billTo: {
    name: string;
    address: string;
    email: string;
    poNumber: string;
  };
  supplier: typeof BILLING_CONFIG.supplier;
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  snapshot: InvoiceSnapshot;
  paidDate: string | null;
  paymentReference: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  /** The voided invoice this one replaces, if any. */
  replacesInvoiceId: string | null;
  createdAt: string;
  createdBy: string;
  issuedAt: string | null;
  issuedBy: string | null;
}

// ---- Money ----------------------------------------------------------------

const zar = new Intl.NumberFormat(BILLING_CONFIG.locale, {
  style: "currency",
  currency: BILLING_CONFIG.currency,
});

/** 150 -> "R 1,50" (en-ZA formatting: space thousands, comma decimals). */
export function formatCents(cents: number): string {
  return zar.format(cents / 100);
}

const count = new Intl.NumberFormat(BILLING_CONFIG.locale);

/** 2914 -> "2 914" in en-ZA. */
export function formatCount(n: number): string {
  return count.format(n);
}

/** VAT on a subtotal, rounded to the nearest cent. 0 while VAT is off. */
export function vatOn(subtotalCents: number): number {
  if (!BILLING_CONFIG.vat.enabled) return 0;
  return Math.round((subtotalCents * BILLING_CONFIG.vat.ratePercent) / 100);
}

// ---- Dates ----------------------------------------------------------------
// Clinics are all in South Africa (UTC+2 all year, no daylight saving). A
// billing month runs from midnight on the 1st, clinic time.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isBillingMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

function assertMonth(month: string): void {
  if (!isBillingMonth(month)) throw new Error(`Not a billing month: ${month}`);
}

/** "2026-10" -> "2026-11" */
export function nextMonth(month: string): string {
  assertMonth(month);
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "2026-01" -> "2025-12" */
export function previousMonth(month: string): string {
  assertMonth(month);
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-10" -> 31 */
export function daysInMonth(month: string): number {
  assertMonth(month);
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-10" -> "October 2026" */
export function monthLabel(month: string): string {
  assertMonth(month);
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The month's boundaries in the two formats the data uses:
 *  - startInstant/endInstant: real moments in time, for createdAt timestamps
 *    and the queue's joinedAt (both true UTC). Start inclusive, end exclusive.
 *  - startWall/endWall: "YYYY-MM-DD" text, for appointDateTime, which stores
 *    clinic wall-clock time with a Z suffix (see clinic-time.ts) and so must
 *    be compared as text, not shifted by two hours.
 */
export function monthRange(month: string): {
  startInstant: Date;
  endInstant: Date;
  startWall: string;
  endWall: string;
} {
  assertMonth(month);
  const next = nextMonth(month);
  return {
    startInstant: new Date(`${month}-01T00:00:00+02:00`),
    endInstant: new Date(`${next}-01T00:00:00+02:00`),
    startWall: `${month}-01`,
    endWall: `${next}-01`,
  };
}

/** Today's date in clinic time, "YYYY-MM-DD". */
export function todayInClinicTime(now = new Date()): string {
  return new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

/** The billing month that "today" falls in, "YYYY-MM". */
export function currentBillingMonth(now = new Date()): string {
  return todayInClinicTime(now).slice(0, 7);
}

/** "2026-11-01" + 30 -> "2026-12-01" */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates (0 if end < start). */
function inclusiveDays(start: string, end: string): number {
  const ms =
    new Date(`${end}T00:00:00Z`).getTime() -
    new Date(`${start}T00:00:00Z`).getTime();
  return ms < 0 ? 0 : Math.round(ms / 86_400_000) + 1;
}

/**
 * How many days of the month the clinic was active, for prorating private
 * fees. Dates are YYYY-MM-DD.
 *  - billingStartDate: first billable day (null = active before this month).
 *  - deactivatedOn: first day NOT active (null = never deactivated).
 *  - reactivatedOn: first day active again after deactivatedOn.
 * Only the most recent deactivate/reactivate pair is known, which is all the
 * clinic record keeps.
 */
export function activeDaysInMonth(
  month: string,
  clinic: {
    billingStartDate: string | null;
    deactivatedOn: string | null;
    reactivatedOn: string | null;
  },
): number {
  const total = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(total).padStart(2, "0")}`;
  const from =
    clinic.billingStartDate && clinic.billingStartDate > first
      ? clinic.billingStartDate
      : first;

  // Active periods as [start, end] inclusive, clipped to the month.
  const periods: Array<[string, string]> = [];
  if (!clinic.deactivatedOn) {
    periods.push([from, last]);
  } else {
    periods.push([from, addDays(clinic.deactivatedOn, -1)]);
    if (clinic.reactivatedOn && clinic.reactivatedOn >= clinic.deactivatedOn) {
      const back =
        clinic.reactivatedOn > from ? clinic.reactivatedOn : from;
      periods.push([back, last]);
    }
  }
  let days = 0;
  for (const [s, e] of periods) {
    const start = s < from ? from : s;
    const end = e > last ? last : e;
    days += inclusiveDays(start, end);
  }
  return Math.min(days, total);
}

// ---- Plans and amounts ------------------------------------------------------

export function paymentTermsDays(plan: PlanType): number {
  return BILLING_CONFIG[plan].paymentTermsDays;
}

/** Which private tier a month's active-patient count falls in. */
export function privateTierFor(
  activePatients: number,
): { ok: true; tier: PrivateTier } | { ok: false; error: string } {
  const { smallMaxPatients: small, mediumMaxPatients: medium } =
    BILLING_CONFIG.private;
  if (small == null || medium == null) {
    return {
      ok: false,
      error:
        "Private tier limits are not set. Fill in smallMaxPatients and mediumMaxPatients in src/config/billing.ts.",
    };
  }
  if (activePatients <= small) return { ok: true, tier: "small" };
  if (activePatients <= medium) return { ok: true, tier: "medium" };
  return { ok: true, tier: "large" };
}

/** "2026-10-31" -> "31 October 2026" */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The line items and totals for one clinic and one month, plus the snapshot
 * of what they were built from. Returns an error instead of guessing when
 * something it needs is missing.
 */
export function calculateInvoice(input: {
  month: string;
  planType: PlanType;
  activePatients: number;
  activeDays: number;
  pilotEndDate: string | null;
  countSources: InvoiceSnapshot["countSources"];
  countedAt: string;
}):
  | {
      ok: true;
      lineItems: InvoiceLineItem[];
      subtotalCents: number;
      vatCents: number;
      totalCents: number;
      snapshot: InvoiceSnapshot;
    }
  | { ok: false; error: string } {
  const { month, planType, activePatients, activeDays } = input;
  if (!Number.isInteger(activePatients) || activePatients < 0) {
    return { ok: false, error: "Active patient count must be a whole number" };
  }
  const totalDays = daysInMonth(month);
  const label = monthLabel(month);

  const base: InvoiceSnapshot = {
    planType,
    activePatients,
    countSources: input.countSources,
    countedAt: input.countedAt,
    perActivePatientCents: null,
    tier: null,
    tierMonthlyCents: null,
    tierLimits: null,
    activeDays,
    daysInMonth: totalDays,
    paymentTermsDays: paymentTermsDays(planType),
    pilotEndDate: input.pilotEndDate,
    vatEnabled: BILLING_CONFIG.vat.enabled,
    vatRatePercent: BILLING_CONFIG.vat.ratePercent,
  };

  let lineItems: InvoiceLineItem[];
  let snapshot = base;

  if (planType === "public") {
    // Per-patient billing needs no proration: a clinic active for half the
    // month simply has fewer active patients.
    const unit = BILLING_CONFIG.public.perActivePatientCents;
    lineItems = [
      {
        description: `Active patients, ${label}: ${formatCount(activePatients)} × ${formatCents(unit)}`,
        quantity: activePatients,
        unitCents: unit,
        amountCents: activePatients * unit,
      },
    ];
    snapshot = { ...base, perActivePatientCents: unit };
  } else if (planType === "private") {
    const t = privateTierFor(activePatients);
    if (!t.ok) return t;
    const tier = BILLING_CONFIG.private.tiers[t.tier];
    const prorated = activeDays < totalDays;
    const amount = prorated
      ? Math.round((tier.monthlyCents * activeDays) / totalDays)
      : tier.monthlyCents;
    lineItems = [
      {
        description:
          `Monthly subscription, ${tier.label} tier (${formatCount(activePatients)} active patients), ${label}` +
          (prorated ? `, prorated ${activeDays} of ${totalDays} days` : ""),
        quantity: 1,
        unitCents: amount,
        amountCents: amount,
      },
    ];
    snapshot = {
      ...base,
      tier: t.tier,
      tierMonthlyCents: tier.monthlyCents,
      tierLimits: {
        smallMax: BILLING_CONFIG.private.smallMaxPatients,
        mediumMax: BILLING_CONFIG.private.mediumMaxPatients,
      },
    };
  } else {
    const end = input.pilotEndDate
      ? `, pilot ends ${formatDate(input.pilotEndDate)}`
      : ", pilot end date not set";
    lineItems = [
      {
        description: `Pilot, no charge${end}. Active patients, ${label}: ${formatCount(activePatients)}`,
        quantity: activePatients,
        unitCents: BILLING_CONFIG.pilot.monthlyCents,
        amountCents: BILLING_CONFIG.pilot.monthlyCents,
      },
    ];
  }

  const subtotalCents = lineItems.reduce((s, l) => s + l.amountCents, 0);
  const vatCents = vatOn(subtotalCents);
  return {
    ok: true,
    lineItems,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
    snapshot,
  };
}

// ---- Invoice numbers and status ---------------------------------------------

/** (2026, 1) -> "ZEN-2026-0001" */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `${BILLING_CONFIG.invoicePrefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Overdue is worked out, never stored: an issued (unpaid) invoice whose due
 * date has passed in clinic time.
 */
export function isOverdue(
  invoice: Pick<Invoice, "status" | "dueDate">,
  today = todayInClinicTime(),
): boolean {
  return (
    invoice.status === "issued" && !!invoice.dueDate && today > invoice.dueDate
  );
}

/** What to show for status, including the worked-out "overdue". */
export function displayStatus(
  invoice: Pick<Invoice, "status" | "dueDate">,
  today = todayInClinicTime(),
): InvoiceStatus | "overdue" {
  return isOverdue(invoice, today) ? "overdue" : invoice.status;
}
