import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/receptionist/registration")({ component: Registration });

const initial = {
  patientNo: "", fileNo: "Auto-generated", patientName: "",
  district: "City of Johannesburg", town: "", telHome: "", telAlt: "", residential: "", mailing: "", headman: "",
  nationalId: "", altIdType: "Passport", altIdNumber: "",
  dob: "", gender: "F", marital: "Single",
  emName: "", emTel: "", emRel: "", emAddr: "",
  occupation: "Unemployed", employer: "", employerTel: "", employerAddr: "",
  finClass: "Self-pay", scheme: "", schemeNo: "", deps: "0", income: "0", assets: "0",
  payerName: "", payerTel: "", payerRel: "", payerAddr: "",
  remarks: "",
  signature: "", consent: false,
};

function Registration() {
  const [f, setF] = useState(initial);
  const set = (k: keyof typeof initial) => (v: any) => setF({ ...f, [k]: v });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.patientName || !f.nationalId) { toast.error("Patient name and National ID are required"); return; }
    if (!f.consent) { toast.error("Patient/Guardian consent is required"); return; }
    toast.success(`${f.patientName} registered successfully`);
    setF(initial);
  };

  return (
    <AppShell role="receptionist" title="Patient Registration">
      <form onSubmit={submit} className="space-y-6">
        <div className="rounded-xl bg-[oklch(0.18_0.06_260)] text-white p-6 flex items-start justify-between">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-white/60">HILLBROW COMMUNITY HEALTH CENTRE</p>
            <h2 className="text-2xl font-bold mt-1">Patient Registration Form</h2>
            <p className="text-sm text-white/70 mt-1">Capture demographic, financial &amp; consent details for a new patient.</p>
          </div>
          <div className="text-right text-xs text-white/70 bg-white/5 rounded-md px-3 py-2">
            <div className="tracking-wider">DATE / TIME</div>
            <div className="text-white font-mono mt-1">{new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </div>

        <Section id="file-id" title="FILE IDENTIFICATION">
          <Grid cols={2}>
            <Field label="PATIENT NO / OLD FILE NO" value={f.patientNo} onChange={set("patientNo")} placeholder="e.g. P-0492" />
            <Field label="PATIENT NAME *" required value={f.patientName} onChange={set("patientName")} placeholder="Full name as on ID" />
          </Grid>
        </Section>

        <Section id="address" title="ADDRESS">
          <Grid cols={4}>
            <Select label="DISTRICT" value={f.district} onChange={set("district")} options={["City of Johannesburg","City of Tshwane","Ekurhuleni","Sedibeng"]} />
            <Field label="TOWN" value={f.town} onChange={set("town")} placeholder="e.g. Hillbrow" />
            <Field label="TEL (HOME)" value={f.telHome} onChange={set("telHome")} placeholder="011 234 5678" />
            <Field label="TEL (ALTERNATE)" value={f.telAlt} onChange={set("telAlt")} placeholder="082 123 4567" />
          </Grid>
          <Grid cols={2}>
            <Field label="RESIDENTIAL ADDRESS" value={f.residential} onChange={set("residential")} placeholder="Street, suburb" />
            <Field label="MAILING ADDRESS" value={f.mailing} onChange={set("mailing")} placeholder="If different from above" />
          </Grid>
          <Field label="HEADMAN / WARD COUNCILLOR" value={f.headman} onChange={set("headman")} placeholder="Optional" />
        </Section>

        <Section title="IDENTIFICATION & DEMOGRAPHICS">
          <Grid cols={3}>
            <Field label="NATIONAL ID *" required value={f.nationalId} onChange={set("nationalId")} placeholder="13-digit RSA ID" />
            <Select label="ALTERNATE ID TYPE" value={f.altIdType} onChange={set("altIdType")} options={["Passport","Asylum","Refugee","Other"]} />
            <Field label="ALTERNATE ID NUMBER" value={f.altIdNumber} onChange={set("altIdNumber")} placeholder="Document number" />
          </Grid>
          <Grid cols={3}>
            <Field label="DATE OF BIRTH" type="date" value={f.dob} onChange={set("dob")} />
            <Select label="GENDER" value={f.gender} onChange={set("gender")} options={["F","M","Other"]} />
            <Select label="MARITAL STATUS" value={f.marital} onChange={set("marital")} options={["Single","Married","Divorced","Widowed"]} />
          </Grid>
        </Section>

        <Section id="emergency" title="EMERGENCY CONTACT">
          <Grid cols={3}>
            <Field label="NAME" value={f.emName} onChange={set("emName")} placeholder="Full name" />
            <Field label="TEL" value={f.emTel} onChange={set("emTel")} placeholder="082 123 4567" />
            <Field label="RELATIONSHIP" value={f.emRel} onChange={set("emRel")} placeholder="e.g. Spouse, Sibling" />
          </Grid>
          <Field label="ADDRESS" value={f.emAddr} onChange={set("emAddr")} placeholder="Street, suburb, town" />
        </Section>

        <Section id="employment" title="EMPLOYMENT">
          <Grid cols={3}>
            <Select label="OCCUPATION" value={f.occupation} onChange={set("occupation")} options={["Unemployed","Employed","Self-employed","Student","Retired"]} />
            <Field label="EMPLOYER DETAILS" value={f.employer} onChange={set("employer")} placeholder="Company name" />
            <Field label="EMPLOYER TEL" value={f.employerTel} onChange={set("employerTel")} placeholder="011 234 5678" />
          </Grid>
          <Field label="EMPLOYER ADDRESS" value={f.employerAddr} onChange={set("employerAddr")} placeholder="Street, suburb, town" />
        </Section>

        <Section id="financial" title="FINANCIAL CLASSIFICATION">
          <Grid cols={4}>
            <Select label="FINANCIAL CLASSIFICATION" value={f.finClass} onChange={set("finClass")} options={["Self-pay","Medical aid","Subsidised","Indigent"]} />
            <Field label="MEDICAL AID / INSURANCE" value={f.scheme} onChange={set("scheme")} placeholder="Scheme name" />
            <Field label="MEMBERSHIP NUMBER" value={f.schemeNo} onChange={set("schemeNo")} placeholder="Scheme number" />
            <Field label="NO. OF DEPENDENTS" value={f.deps} onChange={set("deps")} placeholder="0" />
          </Grid>
          <Grid cols={2}>
            <Field label="ANNUAL INCOME (R)" value={f.income} onChange={set("income")} placeholder="0" />
            <Field label="TOTAL ASSETS (R)" value={f.assets} onChange={set("assets")} placeholder="0" />
          </Grid>
        </Section>

        <Section title="PERSON RESPONSIBLE FOR PAYMENT OF BILLS">
          <Grid cols={3}>
            <Field label="NAME" value={f.payerName} onChange={set("payerName")} placeholder="Full name" />
            <Field label="TEL" value={f.payerTel} onChange={set("payerTel")} placeholder="082 123 4567" />
            <Field label="RELATION TO PATIENT" value={f.payerRel} onChange={set("payerRel")} placeholder="e.g. Self, Parent" />
          </Grid>
          <Field label="ADDRESS" value={f.payerAddr} onChange={set("payerAddr")} placeholder="Street, suburb, town" />
        </Section>

        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">REMARKS</label>
          <textarea
            value={f.remarks}
            onChange={(e) => set("remarks")(e.target.value)}
            placeholder="Any additional notes from the receptionist…"
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] min-h-28"
          />
        </div>

        <div id="consent" className="rounded-xl bg-[oklch(0.96_0.04_245)] border border-[oklch(0.85_0.07_245)] p-5">
          <h4 className="font-semibold text-sm tracking-wide mb-2">CONSENT &amp; AUTHORISATION</h4>
          <p className="text-xs text-muted-foreground">
            I, the undersigned, hereby grant permission that the nature of my / the patient's illness or condition may be disclosed for billing purposes only. Relevant copies may also be supplied for billing purposes only.
          </p>
          <div className="mt-4">
            <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">PATIENT / GUARDIAN NAME</label>
            <input
              value={f.signature}
              onChange={(e) => set("signature")(e.target.value)}
              placeholder="Full name on signature"
              className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>
          <label className="flex items-start gap-2 mt-3 text-sm">
            <input type="checkbox" checked={f.consent} onChange={(e) => set("consent")(e.target.checked)} className="mt-1" />
            <span><strong>Patient / Guardian confirms consent</strong> — verbal authorisation captured by clerk.</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 bg-[oklch(0.97_0.01_240)] py-3 border-t">
          <p className="text-xs text-muted-foreground">Clerk: <strong>Logged-in user</strong>. All fields above will be saved to the patient master record.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setF(initial)} className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">Clear form</button>
            <button type="submit" className="bg-[oklch(0.55_0.18_245)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[oklch(0.5_0.18_245)]">✓ Register Patient</button>
          </div>
        </div>
      </form>
    </AppShell>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wider text-foreground/80 border-b pb-2">{title}</h3>
      {children}
    </section>
  );
}
function Grid({ cols, children }: { cols: 2 | 3 | 4; children: React.ReactNode }) {
  const c = cols === 2 ? "md:grid-cols-2" : cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 ${c} gap-4`}>{children}</div>;
}
function Field({ label, value, onChange, placeholder, type = "text", required, disabled }: any) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        required={required} disabled={disabled}
        className={`w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] ${disabled ? "bg-secondary text-muted-foreground" : ""}`}
      />
    </div>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-[11px] tracking-wider text-muted-foreground block mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
