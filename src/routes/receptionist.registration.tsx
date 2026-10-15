import { createFileRoute } from "@tanstack/react-router";
import { Loading, Spinner } from "@/components/Loading";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  peekNextPatientId,
  registerPatient,
  resolveCurrentReceptionist,
} from "@/lib/clinic-data";
import {
  DOCUMENT_CHECK_NOTE,
  ID_TYPE_LABELS,
  SA_ID_CHECK_NOTE,
  validateIdByType,
  validateSaId,
  type IdType,
} from "@/lib/sa-id";
import { useState } from "react";
import { toast } from "sonner";
import {
  PatientRegisteredDialog,
  type RegisteredPatient,
} from "@/components/PatientRegisteredDialog";
import { checkContactInUse, contactCheckVerdict } from "@/lib/contact-check";
import { looksLikeEmail } from "@/lib/login-identifier";
import { preferMobileNumber } from "@/lib/patient-invite";
import { useContactCheck } from "@/lib/use-contact-check";

export const Route = createFileRoute("/receptionist/registration")({
  component: Registration,
});

// Reception must be able to register anyone who walks in: SA ID holders,
// foreign nationals, asylum seekers, refugees — and people with no document
// at all. A clinic that can't register an undocumented or asylum-seeking
// patient turns away the people most likely to need it. So the ID is chosen
// by type: strict validation for an SA ID, format-only for other documents,
// and nothing required for "No document".
const ID_TYPE_OPTIONS: Record<IdType | "none", string> = {
  ...ID_TYPE_LABELS,
  none: "No document available",
};

const initial = {
  patientName: "",
  district: "City of Johannesburg",
  town: "",
  telHome: "",
  telAlt: "",
  email: "",
  residential: "",
  mailing: "",
  headman: "",
  idType: "sa_id" as IdType | "none",
  idNumber: "",
  dob: "",
  dobFromId: false,
  gender: "F",
  marital: "Single",
  emName: "",
  emTel: "",
  emRel: "",
  emAddr: "",
  occupation: "Unemployed",
  employer: "",
  employerTel: "",
  employerAddr: "",
  finClass: "Self-pay",
  scheme: "",
  schemeNo: "",
  deps: "0",
  income: "0",
  assets: "0",
  payerName: "",
  payerTel: "",
  payerRel: "",
  payerAddr: "",
  remarks: "",
  signature: "",
  consent: false,
};

const EMAIL_IN_USE = "This email is already registered to another patient.";
const PHONE_IN_USE =
  "This number is already registered to another patient. That's allowed (a parent and child can share one) — just check it's not the same person.";
const BOTH_IN_USE_MESSAGE =
  "This e-mail address and phone number are both already registered to existing patients. This looks like someone who is already on the system — search Patient Profiles instead of registering them again, or change one of the two.";

function Registration() {
  const queryClient = useQueryClient();
  const [f, setF] = useState(initial);
  // The patient number is assigned by the system, never typed in. Shown here
  // so reception can quote it, but it can't be edited.
  const { data: nextPatientId } = useQuery({
    queryKey: ["next-patient-id"],
    queryFn: peekNextPatientId,
  });
  // Set after a successful registration: the confirmation dialog that offers
  // the patient a login (a set-password link by text and/or e-mail).
  const [registered, setRegistered] = useState<RegisteredPatient | null>(null);

  // Live check of the contact details against patients already registered.
  const phonesTyped = [f.telHome.trim(), f.telAlt.trim()].filter(Boolean);
  const contact = useContactCheck(f.email, phonesTyped);
  const found = contact.status === "done" ? contact.result : null;
  const verdict = found
    ? contactCheckVerdict({ email: f.email, phones: phonesTyped }, found)
    : "clear";
  const set =
    <K extends keyof typeof initial>(k: K) =>
    (v: (typeof initial)[K]) =>
      setF({ ...f, [k]: v });

  // A valid SA ID already contains the date of birth — fill it in rather
  // than making reception type it twice (and risk the two disagreeing).
  const setIdNumber = (idNumber: string) => {
    const check = f.idType === "sa_id" ? validateSaId(idNumber) : null;
    setF({
      ...f,
      idNumber,
      ...(check?.valid
        ? { dob: check.dateOfBirth!, dobFromId: true }
        : f.dobFromId
          ? { dob: "", dobFromId: false }
          : {}),
    });
  };
  const setIdType = (idType: string) =>
    setF({
      ...f,
      idType: idType as typeof initial.idType,
      idNumber: "",
      ...(f.dobFromId ? { dob: "", dobFromId: false } : {}),
    });

  // Who's logged in + which real clinic (numeric clinicId) they belong to.
  // Was previously hardcoded to "Hillbrow CHC" / "Logged-in user" regardless
  // of who was actually signed in — see #16 in db-issues.md.
  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
  });

  // Fields below (employment, financial classification, person responsible
  // for payment) have no backing Firestore collection at all — there's
  // nowhere in the schema to store them yet (see #16 in db-issues.md, same
  // situation as the Medical Aid section on the patient side, #10). Rather
  // than silently discarding what the receptionist typed, it's folded into
  // the registration note so it isn't lost — flag this for the team so a
  // real field/collection can be added later.
  const buildRemarks = () => {
    const extra: string[] = [];
    if (f.marital !== "Single") extra.push(`Marital status: ${f.marital}`);
    if (f.occupation !== "Unemployed" || f.employer || f.employerAddr)
      extra.push(
        `Occupation: ${f.occupation}${f.employer ? ` at ${f.employer}` : ""}${f.employerTel ? ` (${f.employerTel})` : ""}${f.employerAddr ? ` — ${f.employerAddr}` : ""}`,
      );
    if (f.finClass !== "Self-pay" || f.scheme)
      extra.push(
        `Financial: ${f.finClass}${f.scheme ? `, ${f.scheme} ${f.schemeNo}` : ""}, dependents: ${f.deps}, income: R${f.income}, assets: R${f.assets}`,
      );
    if (f.payerName)
      extra.push(
        `Bill payer: ${f.payerName} (${f.payerRel}) ${f.payerTel} — ${f.payerAddr}`,
      );
    if (f.headman) extra.push(`Headman/Ward councillor: ${f.headman}`);
    if (f.signature) extra.push(`Consent signed by: ${f.signature}`);
    const combined = [f.remarks.trim(), ...extra].filter(Boolean).join(" | ");
    return combined;
  };

  const register = useMutation({
    mutationFn: () =>
      registerPatient({
        fullName: f.patientName,
        nationalId:
          f.idType === "none"
            ? ""
            : f.idType === "sa_id"
              ? f.idNumber.replace(/\s+/g, "")
              : f.idNumber.replace(/\s+/g, "").toUpperCase(),
        idType: f.idType,
        // A text can only reach a mobile, so a mobile given as the alternate
        // number is kept over a landline typed first.
        contactNum: preferMobileNumber(f.telHome, f.telAlt),
        email: f.email.trim(),
        city: f.district,
        suburb: f.town,
        emergencyContactName: f.emName,
        emergencyContactNo: f.emTel,
        // Collected on this form but never sent before — see RegistrationInput.
        residentialAddress: f.residential,
        mailingAddress: f.mailing,
        emergencyContactRelationship: f.emRel,
        emergencyContactAddress: f.emAddr,
        // submit() already refuses to get here without the box ticked; this
        // records that it was, as a field of its own.
        popiaConsent: f.consent,
        insurance: f.scheme
          ? `${f.scheme}${f.schemeNo ? ` · ${f.schemeNo}` : ""}`
          : "",
        remarks: buildRemarks(),
        clinicId: receptionist?.clinicId ?? null,
        dob: f.dob,
        gender: f.gender,
        actorId: receptionist?.receptionistId,
      }),
    onSuccess: (patientId) => {
      // The dialog always appears: it confirms the registration, and offers a
      // login link when there is a number or address to send one to.
      setRegistered({
        patientId,
        name: f.patientName,
        phone: preferMobileNumber(f.telHome, f.telAlt),
        email: f.email.trim(),
      });
      setF(initial);
      queryClient.invalidateQueries({ queryKey: ["next-patient-id"] });
    },
    // registerPatient refuses offline (it allocates shared IDs in a
    // transaction). Its message explains that and says nothing was saved —
    // far more use than "please try again", which invites doing exactly that.
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not register patient — please try again",
      ),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.patientName) {
      toast.error("Patient name is required");
      return;
    }
    if (f.email.trim() && !looksLikeEmail(f.email)) {
      toast.error("That e-mail address doesn't look right");
      return;
    }
    if (f.idType !== "none") {
      const check = validateIdByType(f.idNumber, f.idType);
      if (!check.valid) {
        toast.error(check.reason);
        return;
      }
    }
    if (!f.consent) {
      toast.error("Patient/Guardian consent is required");
      return;
    }
    // The live check may not have finished (or may be stale); look again now.
    if (verdict === "block") {
      toast.error(BOTH_IN_USE_MESSAGE);
      return;
    }
    try {
      const fresh = await checkContactInUse({
        email: f.email,
        phones: phonesTyped,
      });
      if (
        contactCheckVerdict({ email: f.email, phones: phonesTyped }, fresh) ===
        "block"
      ) {
        toast.error(BOTH_IN_USE_MESSAGE);
        return;
      }
    } catch (error) {
      // Not being able to check must not stop someone being registered.
      console.warn("Contact check unavailable at submit:", error);
    }
    register.mutate();
  };

  return (
    <AppShell
      role="receptionist"
      title="Patient Registration"
      clinicNameOverride={receptionist?.clinicName}
    >
      <form onSubmit={submit} className="space-y-6">
        {registered && (
          <PatientRegisteredDialog
            key={registered.patientId}
            patient={registered}
            onClose={(outcome) => {
              toast.success(
                outcome === "sent"
                  ? `${registered.name} registered — login link sent`
                  : `${registered.name} registered — Patient ID ${registered.patientId}. No login link sent.`,
              );
              setRegistered(null);
            }}
          />
        )}
        <div className="rounded-xl bg-[oklch(0.18_0.06_260)] text-white p-6 flex items-start justify-between">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-white/60">
              {receptionist?.clinicName
                ? receptionist.clinicName.toUpperCase()
                : "LOADING CLINIC…"}
            </p>
            <h2 className="text-2xl font-bold mt-1">
              Patient Registration Form
            </h2>
            <p className="text-sm text-white/70 mt-1">
              Capture demographic, financial &amp; consent details for a new
              patient.
            </p>
          </div>
          <div className="text-right text-xs text-white/70 bg-white/5 rounded-md px-3 py-2">
            <div className="tracking-wider">DATE / TIME</div>
            <div className="text-white font-mono mt-1">
              {new Date().toLocaleString("en-GB", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>

        <Section id="file-id" title="FILE IDENTIFICATION">
          <Grid cols={2}>
            <Field
              label="PATIENT NO"
              value={nextPatientId ?? ""}
              loading={nextPatientId == null}
              onChange={() => {}}
              disabled
            />
            <Field
              label="PATIENT NAME *"
              required
              value={f.patientName}
              onChange={set("patientName")}
              placeholder="Full name as on ID"
            />
          </Grid>
        </Section>

        <Section id="address" title="ADDRESS">
          <Grid cols={4}>
            <Select
              label="DISTRICT"
              value={f.district}
              onChange={set("district")}
              options={[
                "City of Johannesburg",
                "City of Tshwane",
                "Ekurhuleni",
                "Sedibeng",
              ]}
            />
            <Field
              label="TOWN"
              value={f.town}
              onChange={set("town")}
              placeholder="e.g. Hillbrow"
            />
            <Field
              label="TEL (HOME)"
              value={f.telHome}
              onChange={set("telHome")}
              placeholder="011 234 5678"
              warning={
                found?.phones[f.telHome.trim()]
                  ? PHONE_IN_USE
                  : undefined
              }
            />
            <Field
              label="TEL (ALTERNATE)"
              value={f.telAlt}
              onChange={set("telAlt")}
              placeholder="082 123 4567"
              warning={
                found?.phones[f.telAlt.trim()] ? PHONE_IN_USE : undefined
              }
            />
          </Grid>
          <Grid cols={2}>
            <Field
              label="EMAIL (OPTIONAL — FOR THEIR LOGIN)"
              type="email"
              value={f.email}
              onChange={set("email")}
              placeholder="name@example.com"
              warning={found?.email ? EMAIL_IN_USE : undefined}
            />
          </Grid>
          <Grid cols={2}>
            <Field
              label="RESIDENTIAL ADDRESS"
              value={f.residential}
              onChange={set("residential")}
              placeholder="Street, suburb"
            />
            <Field
              label="MAILING ADDRESS"
              value={f.mailing}
              onChange={set("mailing")}
              placeholder="If different from above"
            />
          </Grid>
          <Field
            label="HEADMAN / WARD COUNCILLOR"
            value={f.headman}
            onChange={set("headman")}
            placeholder="Optional"
          />
        </Section>

        <Section title="IDENTIFICATION & DEMOGRAPHICS">
          <Grid cols={2}>
            <Select
              label="IDENTITY DOCUMENT *"
              value={f.idType}
              onChange={setIdType}
              options={ID_TYPE_OPTIONS}
            />
            {f.idType !== "none" && (
              <Field
                label={`${ID_TYPE_OPTIONS[f.idType].toUpperCase()} NUMBER *`}
                required
                value={f.idNumber}
                onChange={setIdNumber}
                placeholder={
                  f.idType === "sa_id" ? "13-digit RSA ID" : "Document number"
                }
              />
            )}
          </Grid>
          <p className="text-xs text-muted-foreground">
            {f.idType === "sa_id"
              ? SA_ID_CHECK_NOTE
              : f.idType === "none"
                ? "The patient can be registered without a document. Search Patient Profiles by name first so they don't end up with two records."
                : DOCUMENT_CHECK_NOTE}
          </p>
          <Grid cols={3}>
            <div>
              <Field
                label="DATE OF BIRTH"
                type="date"
                value={f.dob}
                onChange={(v) => setF({ ...f, dob: v, dobFromId: false })}
              />
              {f.dobFromId && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Filled in from the ID number.
                </p>
              )}
            </div>
            <Select
              label="GENDER"
              value={f.gender}
              onChange={set("gender")}
              options={["F", "M", "Other"]}
            />
            <Select
              label="MARITAL STATUS"
              value={f.marital}
              onChange={set("marital")}
              options={["Single", "Married", "Divorced", "Widowed"]}
            />
          </Grid>
        </Section>

        <Section id="emergency" title="EMERGENCY CONTACT">
          <Grid cols={3}>
            <Field
              label="NAME"
              value={f.emName}
              onChange={set("emName")}
              placeholder="Full name"
            />
            <Field
              label="TEL"
              value={f.emTel}
              onChange={set("emTel")}
              placeholder="082 123 4567"
            />
            <Field
              label="RELATIONSHIP"
              value={f.emRel}
              onChange={set("emRel")}
              placeholder="e.g. Spouse, Sibling"
            />
          </Grid>
          <Field
            label="ADDRESS"
            value={f.emAddr}
            onChange={set("emAddr")}
            placeholder="Street, suburb, town"
          />
        </Section>

        <Section id="employment" title="EMPLOYMENT">
          <Grid cols={3}>
            <Select
              label="OCCUPATION"
              value={f.occupation}
              onChange={set("occupation")}
              options={[
                "Unemployed",
                "Employed",
                "Self-employed",
                "Student",
                "Retired",
              ]}
            />
            <Field
              label="EMPLOYER DETAILS"
              value={f.employer}
              onChange={set("employer")}
              placeholder="Company name"
            />
            <Field
              label="EMPLOYER TEL"
              value={f.employerTel}
              onChange={set("employerTel")}
              placeholder="011 234 5678"
            />
          </Grid>
          <Field
            label="EMPLOYER ADDRESS"
            value={f.employerAddr}
            onChange={set("employerAddr")}
            placeholder="Street, suburb, town"
          />
        </Section>

        <Section id="financial" title="FINANCIAL CLASSIFICATION">
          <Grid cols={4}>
            <Select
              label="FINANCIAL CLASSIFICATION"
              value={f.finClass}
              onChange={set("finClass")}
              options={["Self-pay", "Medical aid", "Subsidised", "Indigent"]}
            />
            <Field
              label="MEDICAL AID / INSURANCE"
              value={f.scheme}
              onChange={set("scheme")}
              placeholder="Scheme name"
            />
            <Field
              label="MEMBERSHIP NUMBER"
              value={f.schemeNo}
              onChange={set("schemeNo")}
              placeholder="Scheme number"
            />
            <Field
              label="NO. OF DEPENDENTS"
              value={f.deps}
              onChange={set("deps")}
              placeholder="0"
            />
          </Grid>
          <Grid cols={2}>
            <Field
              label="ANNUAL INCOME (R)"
              value={f.income}
              onChange={set("income")}
              placeholder="0"
            />
            <Field
              label="TOTAL ASSETS (R)"
              value={f.assets}
              onChange={set("assets")}
              placeholder="0"
            />
          </Grid>
        </Section>

        <Section title="PERSON RESPONSIBLE FOR PAYMENT OF BILLS">
          <Grid cols={3}>
            <Field
              label="NAME"
              value={f.payerName}
              onChange={set("payerName")}
              placeholder="Full name"
            />
            <Field
              label="TEL"
              value={f.payerTel}
              onChange={set("payerTel")}
              placeholder="082 123 4567"
            />
            <Field
              label="RELATION TO PATIENT"
              value={f.payerRel}
              onChange={set("payerRel")}
              placeholder="e.g. Self, Parent"
            />
          </Grid>
          <Field
            label="ADDRESS"
            value={f.payerAddr}
            onChange={set("payerAddr")}
            placeholder="Street, suburb, town"
          />
        </Section>

        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">
            REMARKS
          </label>
          <textarea
            value={f.remarks}
            onChange={(e) => set("remarks")(e.target.value)}
            placeholder="Any additional notes from the receptionist…"
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] min-h-28"
          />
        </div>

        <div
          id="consent"
          className="rounded-xl bg-[oklch(0.96_0.04_245)] border border-[oklch(0.85_0.07_245)] p-5"
        >
          <h4 className="font-semibold text-sm tracking-wide mb-2">
            CONSENT &amp; AUTHORISATION
          </h4>
          <p className="text-xs text-muted-foreground">
            I, the undersigned, hereby grant permission that the nature of my /
            the patient's illness or condition may be disclosed for billing
            purposes only. Relevant copies may also be supplied for billing
            purposes only.
          </p>
          <div className="mt-4">
            <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">
              PATIENT / GUARDIAN NAME
            </label>
            <input
              value={f.signature}
              onChange={(e) => set("signature")(e.target.value)}
              placeholder="Full name on signature"
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>
          <label className="flex items-start gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={f.consent}
              onChange={(e) => set("consent")(e.target.checked)}
              className="mt-1"
            />
            <span>
              <strong>Patient / Guardian confirms consent</strong> — verbal
              authorisation captured by clerk.
            </span>
          </label>
        </div>

        {verdict === "block" && (
          <p
            role="alert"
            data-testid="duplicate-block"
            className="rounded-md border border-[oklch(0.8_0.12_25)] bg-[oklch(0.97_0.03_25)] px-4 py-3 text-sm text-[oklch(0.35_0.15_25)]"
          >
            {BOTH_IN_USE_MESSAGE}
          </p>
        )}
        {contact.status === "unavailable" && (
          <p className="text-xs text-muted-foreground">
            Couldn't check whether these contact details are already
            registered.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-[oklch(0.97_0.01_240)] py-3 border-t">
          <p className="text-xs text-muted-foreground">
            Clerk:{" "}
            <strong>
              {receptionist?.name ?? <Loading label="Loading" size={12} />}
            </strong>
            . All fields above will be saved to the patient master record.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setF(initial)}
              className="border px-4 py-2 rounded-md text-sm hover:bg-secondary"
            >
              Clear form
            </button>
            <button
              type="submit"
              disabled={register.isPending || verdict === "block"}
              className="bg-[oklch(0.55_0.18_245)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[oklch(0.5_0.18_245)] disabled:opacity-60"
            >
              {register.isPending ? "Registering…" : "Register Patient"}
            </button>
          </div>
        </div>
      </form>
    </AppShell>
  );
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wider text-foreground/80 border-b pb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}
function Grid({
  cols,
  children,
}: {
  cols: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const c =
    cols === 2
      ? "md:grid-cols-2"
      : cols === 3
        ? "md:grid-cols-3"
        : "md:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 ${c} gap-4`}>{children}</div>;
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  disabled,
  loading,
  warning,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  /** Waiting for the value to arrive: shows a spinner in the box. */
  loading?: boolean;
  /** Something worth knowing about what was typed; doesn't stop anything. */
  warning?: string;
}) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-busy={loading || undefined}
          className={`w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] ${disabled ? "bg-secondary text-muted-foreground" : ""}`}
        />
        {loading && (
          <Spinner
            label="Loading"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        )}
      </div>
      {warning && (
        <p
          role="status"
          className="mt-1 text-[11px] leading-snug text-amber-800"
          data-testid="field-warning"
        >
          {warning}
        </p>
      )}
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
  /** Plain list (value = label), or a value -> label map. */
  options: string[] | Record<string, string>;
}) {
  const entries = Array.isArray(options)
    ? options.map((o) => [o, o] as const)
    : Object.entries(options);
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white"
      >
        {entries.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
