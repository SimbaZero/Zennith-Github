// ---------------------------------------------------------------------------
// Billing — Firestore reads and writes.
//
// Where billing data lives (all under the clinic, never on the clinic record
// itself, because clinic records are readable by anyone):
//   clinics/{clinicId}/billing/settings        per-clinic billing settings
//   clinics/{clinicId}/invoices/{invoiceId}    invoices, drafts included
//   clinics/{clinicId}/billingMonths/{YYYY-MM} which invoice holds that month
//   billingCounters/{year}                     last invoice number issued
//
// Rules this file keeps (the Firestore rules must enforce them too):
//  - One non-void invoice per clinic per month, checked in a transaction.
//  - Invoice numbers are given out only at issue, inside the same
//    transaction that issues the invoice, so there are no gaps or repeats.
//  - An issued invoice never changes, except its status and payment fields.
//    Corrections are a void (with a reason) plus a new invoice.
//  - Every settings change, issue, payment and void writes its audit entry
//    in the same transaction or batch, so neither can save without the other.
//
// COUNTS ONLY: the active-patient count reads patient numbers (like "Pat-12")
// and keeps only how many distinct ones there are. It never opens a patient,
// user or medical record, and nothing here returns patient-level detail.
// ---------------------------------------------------------------------------

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/firebase";
import { assertOnline, runTransactionOnline } from "@/lib/offline";
import { getUsername } from "@/lib/auth";
import { clinicIdVariants } from "@/lib/clinic-id";
import { listClinics, type ClinicRecord } from "@/lib/clinic-data";
import { BILLING_CONFIG, type PlanType } from "@/config/billing";
import {
  activeDaysInMonth,
  addDays,
  calculateInvoice,
  formatInvoiceNumber,
  isBillingMonth,
  monthLabel,
  monthRange,
  todayInClinicTime,
  type ClinicBillingSettings,
  type Invoice,
  type InvoiceSnapshot,
} from "@/lib/billing";

// ---- Paths -----------------------------------------------------------------

const settingsRef = (clinicId: number) =>
  doc(db, "clinics", String(clinicId), "billing", "settings");
const invoicesCol = (clinicId: number) =>
  collection(db, "clinics", String(clinicId), "invoices");
const invoiceRef = (clinicId: number, invoiceId: string) =>
  doc(db, "clinics", String(clinicId), "invoices", invoiceId);
const monthLockRef = (clinicId: number, month: string) =>
  doc(db, "clinics", String(clinicId), "billingMonths", month);
const counterRef = (year: number) =>
  doc(db, "billingCounters", String(year));

function actor(): string {
  return getUsername() || "unknown";
}

/** Adds an audit entry to a transaction or batch, so it saves with the change. */
function auditInto(
  // A transaction or a batch: anything that can stage a write.
  w: { set(ref: DocumentReference, data: DocumentData): unknown },
  clinicId: number,
  action_type: string,
  description: string,
): void {
  w.set(doc(collection(db, "systemAudit")), {
    clinicId,
    actor_id: actor(),
    action_type,
    description,
    timestamp: serverTimestamp(),
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Settings ----------------------------------------------------------------

/**
 * Suggested settings for a clinic that has none saved yet. Shown on the
 * settings form for the Super Admin to check — never used to bill until saved.
 */
export function suggestedSettings(clinic: ClinicRecord): ClinicBillingSettings {
  const planType: PlanType = clinic.type === "private" ? "private" : "public";
  return {
    planType,
    billToName:
      planType === "public"
        ? BILLING_CONFIG.public.defaultBillToName
        : clinic.clinicName,
    // clinic.address holds map coordinates, not a postal address, so it is
    // deliberately not copied here.
    billToAddress: "",
    poNumber: "",
    billingEmail: clinic.billingEmail || clinic.contactEmail || "",
    pilotEndDate: null,
    billingStartDate: clinic.approvedAt ? clinic.approvedAt.slice(0, 10) : null,
  };
}

function toSettings(d: DocumentData): ClinicBillingSettings {
  return {
    planType: d.planType,
    billToName: d.billToName ?? "",
    billToAddress: d.billToAddress ?? "",
    poNumber: d.poNumber ?? "",
    billingEmail: d.billingEmail ?? "",
    pilotEndDate: d.pilotEndDate ?? null,
    billingStartDate: d.billingStartDate ?? null,
    updatedAt: d.updatedAt,
    updatedBy: d.updatedBy,
  };
}

/** Saved settings, or null if this clinic's billing has never been set up. */
export async function getBillingSettings(
  clinicId: number,
): Promise<ClinicBillingSettings | null> {
  const snap = await getDoc(settingsRef(clinicId));
  return snap.exists() ? toSettings(snap.data()) : null;
}

/** Every clinic's saved settings, keyed by clinicId (Super Admin overview). */
export async function getAllBillingSettings(): Promise<
  Map<number, ClinicBillingSettings>
> {
  const out = new Map<number, ClinicBillingSettings>();
  const snap = await getDocs(collectionGroup(db, "billing"));
  for (const d of snap.docs) {
    if (d.id !== "settings") continue;
    const clinicId = Number(d.ref.parent.parent?.id);
    if (Number.isFinite(clinicId)) out.set(clinicId, toSettings(d.data()));
  }
  return out;
}

/** Checks a settings form. Returns a list of problems, empty when it's fine. */
export function validateSettings(s: ClinicBillingSettings): string[] {
  const problems: string[] = [];
  if (!["public", "private", "pilot"].includes(s.planType))
    problems.push("Choose a plan type");
  if (!s.billToName.trim()) problems.push("Bill-to name is required");
  if (s.billingEmail.trim() && !/^\S+@\S+\.\S+$/.test(s.billingEmail.trim()))
    problems.push("Billing email doesn't look like an email address");
  if (s.planType === "pilot" && !s.pilotEndDate)
    problems.push("Pilot clinics need a pilot end date");
  if (s.pilotEndDate && !DATE_RE.test(s.pilotEndDate))
    problems.push("Pilot end date must be a date");
  if (s.billingStartDate && !DATE_RE.test(s.billingStartDate))
    problems.push("Billing start date must be a date");
  return problems;
}

/**
 * Saves a clinic's billing settings. Affects drafts made from now on only:
 * every invoice keeps its own copy of the plan and bill-to details.
 */
export async function saveBillingSettings(
  clinicId: number,
  s: ClinicBillingSettings,
): Promise<void> {
  assertOnline();
  const problems = validateSettings(s);
  if (problems.length) throw new Error(problems.join(". "));
  const before = await getBillingSettings(clinicId);
  const clean = {
    planType: s.planType,
    billToName: s.billToName.trim(),
    billToAddress: s.billToAddress.trim(),
    poNumber: s.poNumber.trim(),
    billingEmail: s.billingEmail.trim(),
    pilotEndDate: s.pilotEndDate || null,
    billingStartDate: s.billingStartDate || null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor(),
  };
  const changed = before
    ? (Object.keys(clean) as Array<keyof typeof clean>)
        .filter((k) => k !== "updatedAt" && k !== "updatedBy")
        .filter((k) => (before as any)[k] !== clean[k])
    : ["all fields (first set-up)"];
  const batch = writeBatch(db);
  batch.set(settingsRef(clinicId), clean);
  auditInto(
    batch,
    clinicId,
    "billing.settings",
    `Billing settings for clinic ${clinicId} updated: ${changed.join(", ") || "no changes"}` +
      (before && before.planType !== clean.planType
        ? ` (plan ${before.planType} → ${clean.planType}, future invoices only)`
        : ""),
  );
  await batch.commit();
}

// ---- Active-patient count ----------------------------------------------------

/**
 * Distinct patients with at least one dispense, appointment or reception
 * check-in at this clinic in the month. Cancelled and no-show appointments
 * don't count. Read straight from the server (never the offline cache), so a
 * count is never built on stale data.
 *
 * Known gaps, from how the data is stored today:
 *  - Appointments booked before clinicId was added to them carry no clinic,
 *    so they can't be counted.
 *  - A walk-in removed from the queue is deleted, so isn't counted.
 */
export async function countActivePatients(
  clinicId: number,
  month: string,
): Promise<{
  activePatients: number;
  countSources: InvoiceSnapshot["countSources"];
}> {
  assertOnline();
  const r = monthRange(month);
  const ids = clinicIdVariants(clinicId);

  const [dispenses, appointments, checkIns] = await Promise.all([
    getDocsFromServer(
      query(
        collection(db, "patientDispensing"),
        where("clinicId", "in", ids),
        where("createdAt", ">=", Timestamp.fromDate(r.startInstant)),
        where("createdAt", "<", Timestamp.fromDate(r.endInstant)),
      ),
    ),
    // appointDateTime is clinic wall-clock text, so compared as text.
    getDocsFromServer(
      query(
        collection(db, "appointments"),
        where("clinicId", "in", ids),
        where("appointDateTime", ">=", r.startWall),
        where("appointDateTime", "<", r.endWall),
      ),
    ),
    getDocsFromServer(
      query(
        collection(db, "queue"),
        where("facilityId", "==", String(clinicId)),
        where("joinedAt", ">=", r.startInstant.toISOString()),
        where("joinedAt", "<", r.endInstant.toISOString()),
      ),
    ),
  ]);

  const patients = new Set<string>();
  const add = (pid: unknown) => {
    if (pid != null && String(pid).trim()) patients.add(String(pid));
  };
  dispenses.docs.forEach((d) => add(d.data().patientId));
  appointments.docs.forEach((d) => {
    const s = String(d.data().status ?? "").toLowerCase();
    if (s.includes("cancel") || s.includes("no-show") || s.includes("no show"))
      return;
    add(d.data().patientId);
  });
  checkIns.docs.forEach((d) => add(d.data().patientId));

  return {
    activePatients: patients.size,
    countSources: {
      dispenses: dispenses.size,
      appointments: appointments.size,
      checkIns: checkIns.size,
    },
  };
}

// ---- Reading invoices ---------------------------------------------------------

function toInvoice(id: string, d: DocumentData): Invoice {
  return {
    id,
    clinicId: Number(d.clinicId),
    clinicName: d.clinicName ?? "",
    billingMonth: d.billingMonth,
    invoiceNumber: d.invoiceNumber ?? null,
    issueDate: d.issueDate ?? null,
    dueDate: d.dueDate ?? null,
    status: d.status,
    billTo: d.billTo,
    supplier: d.supplier,
    lineItems: d.lineItems ?? [],
    subtotalCents: d.subtotalCents,
    vatCents: d.vatCents,
    totalCents: d.totalCents,
    snapshot: d.snapshot,
    paidDate: d.paidDate ?? null,
    paymentReference: d.paymentReference ?? null,
    voidReason: d.voidReason ?? null,
    voidedAt: d.voidedAt ?? null,
    voidedBy: d.voidedBy ?? null,
    replacesInvoiceId: d.replacesInvoiceId ?? null,
    createdAt: d.createdAt,
    createdBy: d.createdBy,
    issuedAt: d.issuedAt ?? null,
    issuedBy: d.issuedBy ?? null,
  };
}

/**
 * One invoice, looked up ONLY inside the given clinic. A clinic admin's
 * screens pass their own clinicId from their profile, never one from the
 * address bar — so another clinic's invoice id simply isn't found.
 */
export async function getInvoice(
  clinicId: number,
  invoiceId: string,
): Promise<Invoice | null> {
  const snap = await getDoc(invoiceRef(clinicId, invoiceId));
  if (!snap.exists()) return null;
  const inv = toInvoice(snap.id, snap.data());
  return inv.clinicId === clinicId ? inv : null;
}

/**
 * A clinic's invoices, newest month first. Drafts are left out unless asked
 * for: a clinic admin only ever sees invoices that have been issued.
 */
export async function listClinicInvoices(
  clinicId: number,
  opts: { includeDrafts?: boolean } = {},
): Promise<Invoice[]> {
  const snap = await getDocs(
    opts.includeDrafts
      ? query(invoicesCol(clinicId), orderBy("billingMonth", "desc"))
      : query(
          invoicesCol(clinicId),
          where("status", "in", ["issued", "paid", "void"]),
          orderBy("billingMonth", "desc"),
        ),
  );
  return snap.docs.map((d) => toInvoice(d.id, d.data()));
}

/** Every clinic's invoices (Super Admin only), optionally for one month. */
export async function listAllInvoices(month?: string): Promise<Invoice[]> {
  const snap = await getDocs(
    month
      ? query(
          collectionGroup(db, "invoices"),
          where("billingMonth", "==", month),
        )
      : collectionGroup(db, "invoices"),
  );
  return snap.docs
    .map((d) => toInvoice(d.id, d.data()))
    .sort(
      (a, b) =>
        b.billingMonth.localeCompare(a.billingMonth) ||
        a.clinicName.localeCompare(b.clinicName),
    );
}

// ---- Drafts --------------------------------------------------------------------

export type DraftResult =
  | { clinicId: number; clinicName: string; ok: true; invoiceId: string }
  | { clinicId: number; clinicName: string; ok: false; reason: string };

/**
 * Creates a draft invoice for one clinic and month. Refuses if the clinic
 * has no saved billing settings, wasn't active that month, or already has
 * an invoice for that month that isn't void.
 */
export async function createDraftInvoice(
  clinic: ClinicRecord,
  month: string,
): Promise<DraftResult> {
  const base = { clinicId: clinic.clinicId, clinicName: clinic.clinicName };
  const fail = (reason: string): DraftResult => ({ ...base, ok: false, reason });
  assertOnline();
  if (!isBillingMonth(month)) return fail(`"${month}" is not a month`);
  if (clinic.status === "pending") return fail("Application not yet approved");

  const settings = await getBillingSettings(clinic.clinicId);
  if (!settings) return fail("Billing settings not set up yet");

  const activeDays = activeDaysInMonth(month, {
    billingStartDate: settings.billingStartDate,
    deactivatedOn: clinic.deactivatedOn ?? null,
    reactivatedOn: clinic.reactivatedOn ?? null,
  });
  if (activeDays === 0) return fail(`Not active in ${monthLabel(month)}`);

  // Cheap early check, so a clinic that already has an invoice isn't
  // counted for nothing. The transaction below checks again for real.
  const existing = await getDoc(monthLockRef(clinic.clinicId, month));
  if (existing.exists()) {
    const held = await getDoc(
      invoiceRef(clinic.clinicId, existing.data().invoiceId),
    );
    if (held.exists() && held.data().status !== "void")
      return fail(`Already has a ${held.data().status} invoice for ${monthLabel(month)}`);
  }

  const { activePatients, countSources } = await countActivePatients(
    clinic.clinicId,
    month,
  );
  const calc = calculateInvoice({
    month,
    planType: settings.planType,
    activePatients,
    activeDays,
    pilotEndDate: settings.pilotEndDate,
    countSources,
    countedAt: new Date().toISOString(),
  });
  if (!calc.ok) return fail(calc.error);

  const newRef = doc(invoicesCol(clinic.clinicId));
  try {
    await runTransactionOnline(db, async (tx) => {
      const lockRef = monthLockRef(clinic.clinicId, month);
      const lock = await tx.get(lockRef);
      let replaces: string | null = null;
      if (lock.exists()) {
        const heldId = lock.data().invoiceId as string;
        const held = await tx.get(invoiceRef(clinic.clinicId, heldId));
        if (held.exists() && held.data().status !== "void") {
          throw new Error(
            `Already has a ${held.data().status} invoice for ${monthLabel(month)}`,
          );
        }
        if (held.exists()) replaces = heldId;
      }
      tx.set(newRef, {
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        billingMonth: month,
        invoiceNumber: null,
        issueDate: null,
        dueDate: null,
        status: "draft",
        billTo: {
          name: settings.billToName,
          address: settings.billToAddress,
          email: settings.billingEmail,
          poNumber: settings.poNumber,
        },
        supplier: { ...BILLING_CONFIG.supplier },
        lineItems: calc.lineItems,
        subtotalCents: calc.subtotalCents,
        vatCents: calc.vatCents,
        totalCents: calc.totalCents,
        snapshot: calc.snapshot,
        paidDate: null,
        paymentReference: null,
        voidReason: null,
        voidedAt: null,
        voidedBy: null,
        replacesInvoiceId: replaces,
        createdAt: new Date().toISOString(),
        createdBy: actor(),
        issuedAt: null,
        issuedBy: null,
      });
      tx.set(lockRef, { invoiceId: newRef.id, billingMonth: month });
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not create draft");
  }
  return { ...base, ok: true, invoiceId: newRef.id };
}

/**
 * Drafts for every clinic that was active in the month, one clinic at a
 * time. A clinic that can't be drafted is reported, not fatal to the rest.
 */
export async function generateDraftsForMonth(
  month: string,
): Promise<DraftResult[]> {
  assertOnline();
  const clinics = (await listClinics()).filter((c) => c.status !== "pending");
  const results: DraftResult[] = [];
  for (const clinic of clinics) {
    try {
      results.push(await createDraftInvoice(clinic, month));
    } catch (err) {
      results.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        ok: false,
        reason: err instanceof Error ? err.message : "Unexpected error",
      });
    }
  }
  return results;
}

/** Throws away a draft (it has no number yet, so nothing is lost). */
export async function discardDraft(
  clinicId: number,
  invoiceId: string,
): Promise<void> {
  await runTransactionOnline(db, async (tx) => {
    const ref = invoiceRef(clinicId, invoiceId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Invoice not found");
    const inv = snap.data();
    if (inv.status !== "draft")
      throw new Error("Only a draft can be discarded. Void it instead.");
    const lockRef = monthLockRef(clinicId, inv.billingMonth);
    const lock = await tx.get(lockRef);
    tx.delete(ref);
    if (lock.exists() && lock.data().invoiceId === invoiceId) {
      // Point the month back at the void invoice this draft was replacing,
      // or free it entirely.
      if (inv.replacesInvoiceId)
        tx.set(lockRef, {
          invoiceId: inv.replacesInvoiceId,
          billingMonth: inv.billingMonth,
        });
      else tx.delete(lockRef);
    }
    auditInto(
      tx,
      clinicId,
      "billing.draft-discard",
      `Discarded draft invoice for clinic ${clinicId}, ${monthLabel(inv.billingMonth)}`,
    );
  });
}

// ---- Issue, pay, void -------------------------------------------------------------

/**
 * Issues a draft: gives it the next invoice number for this year, today's
 * issue date and its due date, in one transaction. Two Super Admins issuing
 * at the same moment are serialised by the counter, so a number is never
 * given out twice and never skipped.
 */
export async function issueInvoice(
  clinicId: number,
  invoiceId: string,
): Promise<string> {
  const issueDate = todayInClinicTime();
  const year = Number(issueDate.slice(0, 4));
  return runTransactionOnline(db, async (tx) => {
    const ref = invoiceRef(clinicId, invoiceId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Invoice not found");
    const inv = snap.data();
    if (inv.status !== "draft")
      throw new Error(`This invoice is already ${inv.status}`);
    const cRef = counterRef(year);
    const counter = await tx.get(cRef);
    const next = (counter.exists() ? Number(counter.data().last) : 0) + 1;
    const number = formatInvoiceNumber(year, next);
    const terms = Number(inv.snapshot?.paymentTermsDays ?? 30);

    tx.set(cRef, { last: next, year });
    tx.update(ref, {
      status: "issued",
      invoiceNumber: number,
      issueDate,
      dueDate: addDays(issueDate, terms),
      issuedAt: new Date().toISOString(),
      issuedBy: actor(),
    });
    auditInto(
      tx,
      clinicId,
      "billing.issue",
      `Issued invoice ${number} to clinic ${clinicId} for ${monthLabel(inv.billingMonth)}, total ${inv.totalCents} cents`,
    );
    return number;
  });
}

/** Issues every draft for a month, one after another, in clinic-name order. */
export async function issueAllDrafts(
  month: string,
): Promise<Array<{ invoiceId: string; clinicName: string; ok: boolean; result: string }>> {
  const drafts = (await listAllInvoices(month))
    .filter((i) => i.status === "draft")
    .sort((a, b) => a.clinicName.localeCompare(b.clinicName));
  const out = [];
  for (const d of drafts) {
    try {
      const n = await issueInvoice(d.clinicId, d.id);
      out.push({ invoiceId: d.id, clinicName: d.clinicName, ok: true, result: n });
    } catch (err) {
      out.push({
        invoiceId: d.id,
        clinicName: d.clinicName,
        ok: false,
        result: err instanceof Error ? err.message : "Could not issue",
      });
    }
  }
  return out;
}

/** Records an EFT payment against an issued invoice. */
export async function markInvoicePaid(
  clinicId: number,
  invoiceId: string,
  paidDate: string,
  reference: string,
): Promise<void> {
  const ref = reference.trim();
  if (!DATE_RE.test(paidDate)) throw new Error("Enter the payment date");
  if (!ref) throw new Error("Enter the EFT reference");
  if (paidDate > todayInClinicTime())
    throw new Error("Payment date can't be in the future");
  await runTransactionOnline(db, async (tx) => {
    const iRef = invoiceRef(clinicId, invoiceId);
    const snap = await tx.get(iRef);
    if (!snap.exists()) throw new Error("Invoice not found");
    const inv = snap.data();
    if (inv.status !== "issued")
      throw new Error(`Only an issued invoice can be marked paid (this one is ${inv.status})`);
    if (inv.issueDate && paidDate < inv.issueDate)
      throw new Error("Payment date is before the invoice was issued");
    tx.update(iRef, {
      status: "paid",
      paidDate,
      paymentReference: ref,
    });
    auditInto(
      tx,
      clinicId,
      "billing.paid",
      `Marked invoice ${inv.invoiceNumber} paid on ${paidDate}, EFT reference ${ref}`,
    );
  });
}

/**
 * Voids an issued or paid invoice. It keeps its number and stays on record;
 * the month is then free for a replacement draft. A reason is required.
 */
export async function voidInvoice(
  clinicId: number,
  invoiceId: string,
  reason: string,
): Promise<void> {
  const why = reason.trim();
  if (why.length < 5) throw new Error("Give a reason for voiding (at least a few words)");
  await runTransactionOnline(db, async (tx) => {
    const iRef = invoiceRef(clinicId, invoiceId);
    const snap = await tx.get(iRef);
    if (!snap.exists()) throw new Error("Invoice not found");
    const inv = snap.data();
    if (inv.status === "draft")
      throw new Error("A draft has no number yet. Discard it instead.");
    if (inv.status === "void") throw new Error("This invoice is already void");
    tx.update(iRef, {
      status: "void",
      voidReason: why,
      voidedAt: new Date().toISOString(),
      voidedBy: actor(),
    });
    auditInto(
      tx,
      clinicId,
      "billing.void",
      `Voided invoice ${inv.invoiceNumber}: ${why}`,
    );
  });
}
