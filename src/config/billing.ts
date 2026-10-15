// ---------------------------------------------------------------------------
// Billing configuration — every price, tier, payment term and supplier detail
// used by the Billing section lives here and nowhere else. Change a price in
// this file and every new draft invoice picks it up; no component holds a
// number of its own.
//
// ALL MONEY IS WHOLE CENTS (integers). R1.50 is 150, R5,000 is 500000. Never
// put a rand amount with decimals here — floating-point rands drift (0.1 + 0.2
// is not 0.3), and an invoice must add up to the cent.
//
// Issued invoices keep a snapshot of the prices they were built with, so
// changing a number here never alters an invoice that has already gone out.
//
// Values in [SQUARE BRACKETS] are placeholders still to be confirmed.
// ---------------------------------------------------------------------------

export const BILLING_CONFIG = {
  currency: "ZAR",
  locale: "en-ZA",

  /** Invoice numbers look like ZEN-2026-0001: prefix, year, 4-digit sequence. */
  invoicePrefix: "ZEN",

  // Zennith is not a VAT vendor, so this stays off. While it is off, invoices
  // show no VAT line and never use the words "Tax Invoice". Switching it on
  // is NOT enough on its own to issue valid tax invoices — the invoice screen
  // shows a warning listing what else is required.
  vat: {
    enabled: false,
    /** 15% as a whole-number percentage, so the maths stays in integers. */
    ratePercent: 15,
  },

  /** Public clinics: a price per active patient per month. */
  public: {
    perActivePatientCents: 150, // R1.50
    paymentTermsDays: 30,
    /** Pre-filled bill-to name for a public clinic; editable per clinic. */
    defaultBillToName: "[PROVINCIAL DEPARTMENT OF HEALTH]",
  },

  /**
   * Private clinics: a flat monthly fee chosen by that month's active patients.
   *   Small:  up to and including smallMaxPatients
   *   Medium: smallMaxPatients + 1 up to and including mediumMaxPatients
   *   Large:  above mediumMaxPatients
   * The two limits are still [X] and [Y]. While either is null, private
   * invoices are refused with a message rather than guessed.
   * Mid-month activation or deactivation prorates the fee by active days.
   */
  private: {
    smallMaxPatients: null as number | null, // [X]
    mediumMaxPatients: null as number | null, // [Y]
    tiers: {
      small: { label: "Small", monthlyCents: 500000 }, // R5,000
      medium: { label: "Medium", monthlyCents: 750000 }, // R7,500
      large: { label: "Large", monthlyCents: 1000000 }, // R10,000
    },
    paymentTermsDays: 30,
  },

  /** Pilot clinics pay nothing, but still get an R0.00 invoice on record. */
  pilot: {
    monthlyCents: 0,
    paymentTermsDays: 30,
  },

  /** Shown on every invoice as the party issuing it. */
  supplier: {
    entityName: "[ENTITY NAME]",
    registrationNumber: "[REGISTRATION NUMBER]",
    csdNumber: "[CENTRAL SUPPLIER DATABASE (CSD) NUMBER]",
    address: "[ADDRESS]",
    bankingDetails: "[BANKING DETAILS]",
    billingEmail: "[BILLING EMAIL]",
  },
} as const;

export type PlanType = "public" | "private" | "pilot";
export type PrivateTier = keyof typeof BILLING_CONFIG.private.tiers;
