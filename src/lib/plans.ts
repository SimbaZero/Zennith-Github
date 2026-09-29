// ---------------------------------------------------------------------------
// Plans and indicative pricing shown when a clinic registers.
//
// THESE NUMBERS ARE A PROPOSAL, NOT A CONTRACT. They are the team's working
// prices, kept in this one file so they can be changed in one place. The
// registration form labels them "indicative, excluding VAT" and says plainly
// that nothing is charged and no payment details are collected. Billing is by
// invoice after approval; card payments need a payment processor that isn't
// connected yet.
// ---------------------------------------------------------------------------

export type BillingCycle = "monthly" | "annual";

export const PRIVATE_PLAN = {
  name: "Private — Standard",
  monthlyZar: 1200,
  /** Ten months' price for twelve months of use. */
  annualZar: 12000,
  includedLogins: 5,
  extraLoginMonthlyZar: 150,
  trialDays: 30,
} as const;

export const PRICING_DISCLAIMER =
  "Indicative pricing, excluding VAT. It is confirmed with you after your application is approved. No payment details are collected now, and nothing is charged.";

/** 1200 -> "R1,200" */
export function formatZar(amount: number): string {
  return `R${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function quotedAmountZar(cycle: BillingCycle): number {
  return cycle === "annual" ? PRIVATE_PLAN.annualZar : PRIVATE_PLAN.monthlyZar;
}

/** "R1,200 per month" / "R12,000 per year" */
export function priceLine(cycle: BillingCycle): string {
  return cycle === "annual"
    ? `${formatZar(PRIVATE_PLAN.annualZar)} per year`
    : `${formatZar(PRIVATE_PLAN.monthlyZar)} per month`;
}

/** Whole months of the annual price that are free (12 - annual / monthly). */
export function annualMonthsFree(): number {
  return Math.round(12 - PRIVATE_PLAN.annualZar / PRIVATE_PLAN.monthlyZar);
}

/** What is saved with the application. Undefined for public clinics. */
export interface BillingChoice {
  cycle: BillingCycle;
  trialRequested: boolean;
  billingEmail: string;
  /** The price the applicant was shown, in rand, for their chosen cycle. */
  quotedZar: number;
}

export function buildBilling(form: {
  type: "public" | "private";
  billingCycle: BillingCycle;
  trialRequested: boolean;
  billingEmail: string;
  contactEmail: string;
}): BillingChoice | undefined {
  if (form.type !== "private") return undefined;
  return {
    cycle: form.billingCycle,
    trialRequested: form.trialRequested,
    // Left blank on the form means "use my contact email".
    billingEmail: form.billingEmail.trim() || form.contactEmail.trim(),
    quotedZar: quotedAmountZar(form.billingCycle),
  };
}

/** "Monthly, starting with a 30-day free trial" — short, for the email. */
export function billingSummary(choice: {
  cycle: BillingCycle;
  trialRequested: boolean;
}): string {
  const cycle = choice.cycle === "annual" ? "Annual" : "Monthly";
  return choice.trialRequested
    ? `${cycle}, starting with a ${PRIVATE_PLAN.trialDays}-day free trial`
    : `${cycle}, no free trial`;
}

/** One line for the Super Admin's review panel. Older applications have no
 *  billing choice recorded, which is said plainly. */
export function describeBilling(clinic: {
  type: "public" | "private";
  billingCycle?: BillingCycle;
  trialRequested?: boolean;
  billingEmail?: string;
  quotedZar?: number;
}): string {
  if (clinic.type !== "private")
    return "Public clinic. No payment is taken through registration.";
  if (!clinic.billingCycle) return "No billing choice recorded";
  const quoted =
    clinic.quotedZar != null
      ? `quoted ${formatZar(clinic.quotedZar)} per ${clinic.billingCycle === "annual" ? "year" : "month"} (excl. VAT)`
      : "no price recorded";
  const email = clinic.billingEmail
    ? `invoices to ${clinic.billingEmail}`
    : "no invoice email";
  return `${billingSummary({ cycle: clinic.billingCycle, trialRequested: !!clinic.trialRequested })} · ${quoted} · ${email}`;
}
