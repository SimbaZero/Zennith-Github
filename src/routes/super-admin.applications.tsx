import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Search,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { auth, db } from "@/firebase";
import {
  approveClinic,
  listClinics,
  rejectClinicApplication,
  type ClinicRecord,
} from "@/lib/clinic-data";
import { getUsername } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { assignClinicAdmin } from "@/lib/super-admin-service";
import { sendClinicDecisionEmail } from "@/lib/clinic-decision-email";
import { isValidEmail } from "@/lib/form-rules";
import { billingSummary, describeBilling } from "@/lib/plans";
import {
  DECISION_ACTION,
  canApprove,
  checklistFor,
  decisionLogText,
  emailFailureText,
  loadFailureText,
  isValidRejectionReason,
  matchesApplicationSearch,
  missingChecks,
  suggestUsername,
  type ChecklistState,
} from "@/lib/application-review";

export const Route = createFileRoute("/super-admin/applications")({
  component: Applications,
});

interface DecisionRow {
  id: string;
  description: string;
  actor: string;
  when: Date | null;
}

interface EmailResult {
  ok: boolean;
  reason?: string;
}

// Every approve / reject is written to the audit log, so this page keeps the
// trail that the old Platform Logs page used to show for onboarding.
async function fetchDecisions(): Promise<DecisionRow[]> {
  const snap = await getDocs(
    query(
      collection(db, "systemAudit"),
      where("action_type", "==", DECISION_ACTION),
      limit(100),
    ),
  );
  return snap.docs
    .map((d) => {
      const data = d.data();
      const ts = data.timestamp;
      return {
        id: d.id,
        description: String(data.description ?? ""),
        actor: String(data.actor_id ?? ""),
        when: ts?.toDate ? (ts.toDate() as Date) : null,
      };
    })
    .sort((a, b) => (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));
}

function formatDate(iso?: string): string {
  if (!iso) return "date not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date not recorded";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Applications() {
  const queryClient = useQueryClient();
  const {
    data: clinics = [],
    isLoading,
    error: clinicsError,
  } = useQuery({
    queryKey: ["clinics"],
    queryFn: listClinics,
  });
  const {
    data: decisions = [],
    isLoading: loadingDecisions,
    error: decisionsError,
  } = useQuery({
    queryKey: ["application-decisions"],
    queryFn: fetchDecisions,
  });
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState<ClinicRecord | null>(null);

  const pending = clinics.filter((c) => c.status === "pending");
  const shown = pending.filter((c) => matchesApplicationSearch(c, search));

  return (
    <AppShell role="super_admin" title="Clinic Applications">
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Clinics that register themselves wait here until you have checked them.
        The checks are done by hand: Zennith is not connected to a regulator or
        a facility register.
      </p>

      <div className="bg-white rounded-xl border overflow-hidden mb-6">
        <div className="p-5 border-b flex flex-wrap items-center gap-3">
          <Clock size={16} className="text-[oklch(0.6_0.18_70)]" />
          <h3 className="font-semibold">Awaiting review</h3>
          <div className="relative ml-2 flex-1 min-w-[12rem] max-w-sm">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, contact, email, registration no…"
              aria-label="Search applications"
              className="w-full border rounded-md pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {isLoading
              ? "Loading..."
              : search.trim()
                ? `${shown.length} of ${pending.length}`
                : `${pending.length} awaiting review`}
          </span>
        </div>

        {clinicsError && (
          <p
            role="alert"
            className="px-5 py-3 text-sm text-amber-900 bg-amber-50 border-b border-amber-200"
          >
            {loadFailureText(clinicsError)}
          </p>
        )}

        <div className="divide-y">
          {shown.map((c) => (
            <div
              key={c.clinicId}
              className="p-5 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold">{c.clinicName}</p>
                  <span
                    className={`text-[10px] tracking-wider px-2 py-0.5 rounded-full border capitalize ${
                      c.type === "private"
                        ? "text-[oklch(0.45_0.18_290)] border-[oklch(0.8_0.12_290)]"
                        : "text-[oklch(0.4_0.15_245)] border-[oklch(0.8_0.1_245)]"
                    }`}
                  >
                    {c.type}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {c.contactName ?? "No contact name"} ·{" "}
                  {c.contactEmail ?? "No email"} · Submitted{" "}
                  {formatDate(c.submittedAt)}
                </p>
              </div>
              <button
                onClick={() => setReviewing(c)}
                className="text-xs bg-[oklch(0.18_0.06_260)] text-white px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] inline-flex items-center gap-1"
              >
                <ClipboardList size={13} /> Review
              </button>
            </div>
          ))}
          {!isLoading && !clinicsError && shown.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              {search.trim()
                ? `No applications match "${search}".`
                : "No applications waiting. New clinic registrations will appear here."}
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold">Recent decisions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every approval and rejection is recorded here, with what was
            checked.
          </p>
        </div>
        <div className="divide-y">
          {decisions.slice(0, 15).map((d) => {
            const approved = d.description.startsWith("Approved");
            return (
              <div key={d.id} className="px-5 py-3 flex items-start gap-3">
                {approved ? (
                  <CheckCircle2
                    size={16}
                    className="text-green-700 mt-0.5 shrink-0"
                  />
                ) : (
                  <XCircle
                    size={16}
                    className="text-destructive mt-0.5 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm">{d.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {d.actor}
                    {d.when
                      ? ` · ${d.when.toLocaleString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : ""}
                  </p>
                </div>
              </div>
            );
          })}
          {decisionsError && (
            <p
              role="alert"
              className="px-5 py-4 text-sm text-amber-900 bg-amber-50"
            >
              {loadFailureText(decisionsError)}
            </p>
          )}
          {!loadingDecisions && !decisionsError && decisions.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              No decisions recorded yet.
            </p>
          )}
        </div>
      </div>

      {reviewing && (
        <ReviewDrawer
          key={reviewing.clinicId}
          clinic={reviewing}
          onClose={() => setReviewing(null)}
          onDecided={() => {
            queryClient.invalidateQueries({ queryKey: ["clinics"] });
            queryClient.invalidateQueries({
              queryKey: ["application-decisions"],
            });
          }}
        />
      )}
    </AppShell>
  );
}

function ReviewDrawer({
  clinic,
  onClose,
  onDecided,
}: {
  clinic: ClinicRecord;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [checks, setChecks] = useState<ChecklistState>({});
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<"review" | "approved" | "rejected">(
    "review",
  );
  const [email, setEmail] = useState<EmailResult | null>(null);

  const items = checklistFor(clinic.type);
  const remaining = missingChecks(clinic.type, checks).length;

  async function sendDecisionEmail(
    outcome: "approved" | "rejected",
    rejectionReason?: string,
  ): Promise<EmailResult> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return { ok: false, reason: "unauthenticated" };
    if (!clinic.contactEmail) return { ok: false, reason: "invalid-input" };
    try {
      return await sendClinicDecisionEmail({
        data: {
          idToken,
          outcome,
          email: clinic.contactEmail,
          contactName: clinic.contactName ?? "",
          clinicName: clinic.clinicName,
          clinicId: clinic.clinicId,
          type: clinic.type,
          reason: rejectionReason,
          billingSummary:
            clinic.type === "private" && clinic.billingCycle
              ? billingSummary({
                  cycle: clinic.billingCycle,
                  trialRequested: !!clinic.trialRequested,
                })
              : undefined,
        },
      });
    } catch {
      return { ok: false, reason: "send-failed" };
    }
  }

  const approve = useMutation({
    mutationFn: async () => {
      const actor = getUsername() || "super_admin";
      await approveClinic(clinic.clinicId, { approvedBy: actor, note });
      logAction({
        clinicId: clinic.clinicId,
        actor_id: actor,
        action_type: DECISION_ACTION,
        description: decisionLogText({
          outcome: "approved",
          clinicName: clinic.clinicName,
          type: clinic.type,
          state: checks,
          note,
        }),
      });
      return sendDecisionEmail("approved");
    },
    onSuccess: (mail) => {
      setEmail(mail);
      setPhase("approved");
      onDecided();
      toast.success("Clinic approved — now live");
    },
    // approveClinic refuses offline: its message says nothing changed.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not approve"),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const actor = getUsername() || "super_admin";
      // Rejecting deletes the application. Only once that is confirmed do we
      // record it and tell the applicant, so nobody is told about a decision
      // that didn't happen.
      await rejectClinicApplication(clinic.clinicId);
      logAction({
        clinicId: null,
        actor_id: actor,
        action_type: DECISION_ACTION,
        description: decisionLogText({
          outcome: "rejected",
          clinicName: clinic.clinicName,
          type: clinic.type,
          state: checks,
          reason,
        }),
      });
      return sendDecisionEmail("rejected", reason.trim());
    },
    onSuccess: (mail) => {
      setEmail(mail);
      setPhase("rejected");
      onDecided();
      toast.success("Application rejected");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not reject"),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${clinic.clinicName}`}
    >
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-white border-l shadow-xl h-full overflow-y-auto p-6">
        <p className="text-[10px] tracking-wider text-muted-foreground">
          CLINIC APPLICATION
        </p>
        <div className="flex items-center gap-2 mt-1">
          <h2 className="font-semibold text-lg">{clinic.clinicName}</h2>
          <span className="text-[10px] tracking-wider px-2 py-0.5 rounded-full border capitalize">
            {clinic.type}
          </span>
        </div>

        {phase === "review" && (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-5">
              <Detail label="Clinic ID" value={String(clinic.clinicId)} />
              <Detail
                label="Submitted"
                value={formatDate(clinic.submittedAt)}
              />
              <Detail label="Contact person" value={clinic.contactName} />
              <Detail label="Email" value={clinic.contactEmail} />
              <Detail label="Phone" value={clinic.contactPhone} />
              <Detail label="Address" value={clinic.address} />
              {clinic.type === "private" && (
                <Detail
                  label="Registration number"
                  value={clinic.registrationNumber}
                  note="Not verified automatically"
                />
              )}
              <Detail
                label="Plan"
                value={
                  clinic.plan === "private-standard"
                    ? "Private — Standard"
                    : "Public — Standard"
                }
              />
              <div className="sm:col-span-2">
                <Detail label="Billing" value={describeBilling(clinic)} />
              </div>
            </dl>

            <div className="mt-6 border rounded-lg p-4">
              <p className="text-sm font-semibold">Due diligence</p>
              <p className="text-xs text-muted-foreground mb-3">
                Tick each check once you have done it yourself.
              </p>
              <div className="space-y-3">
                {items.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!!checks[item.key]}
                      onChange={(e) =>
                        setChecks((c) => ({
                          ...c,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="text-sm block">{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="block mt-4">
                <span className="text-xs text-muted-foreground">
                  Review note (kept in the audit log, not sent to the applicant)
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full border rounded-md px-3 py-2 text-sm mt-1"
                />
              </label>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              The applicant is emailed the outcome. Emailing any address needs a
              verified sending domain, which isn't set up yet, so you will be
              told if an email could not be sent.
            </p>

            {rejecting ? (
              <div className="mt-4 border border-destructive/40 rounded-lg p-4">
                <p className="text-sm font-semibold text-destructive">
                  Reject this application
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  This removes the application. The reason below is emailed to
                  the applicant, so write it for them.
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  aria-label="Reason for rejection"
                  placeholder="e.g. We could not match the registration number to a registered facility."
                  className="w-full border rounded-md px-3 py-2 text-sm"
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setRejecting(false)}
                    disabled={busy}
                    className="flex-1 border py-2 rounded-md text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => reject.mutate()}
                    disabled={busy || !isValidRejectionReason(reason)}
                    className="flex-1 bg-destructive text-white py-2 rounded-md text-sm disabled:opacity-50"
                  >
                    {reject.isPending ? "Rejecting…" : "Confirm rejection"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-5">
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="flex-1 border py-2 rounded-md text-sm"
                >
                  Close
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  className="flex-1 border border-destructive/50 text-destructive py-2 rounded-md text-sm"
                >
                  Reject…
                </button>
                <button
                  onClick={() => approve.mutate()}
                  disabled={busy || !canApprove(clinic.type, checks)}
                  className="flex-1 bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-sm disabled:opacity-50"
                >
                  {approve.isPending ? "Approving…" : "Approve"}
                </button>
              </div>
            )}
            {!rejecting && remaining > 0 && (
              <p className="text-xs text-muted-foreground mt-2 text-right">
                {remaining} check{remaining === 1 ? "" : "s"} left before you
                can approve.
              </p>
            )}
          </>
        )}

        {phase === "approved" && (
          <ApprovedPanel clinic={clinic} email={email} onDone={onClose} />
        )}

        {phase === "rejected" && (
          <div className="mt-5">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-semibold">Application rejected</p>
              <EmailStatus
                email={email}
                clinic={clinic}
                sentText="The rejection email was sent to"
                failedLead="The rejection email was not sent"
              />
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 border py-2 rounded-md text-sm"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailStatus({
  email,
  clinic,
  sentText,
  failedLead,
}: {
  email: EmailResult | null;
  clinic: ClinicRecord;
  sentText: string;
  failedLead: string;
}) {
  if (!email) return null;
  return email.ok ? (
    <p className="text-sm mt-2 text-green-800">
      {sentText} {clinic.contactEmail}.
    </p>
  ) : (
    <p className="text-sm mt-2 text-amber-900">
      {failedLead}: {emailFailureText(email.reason)}. Please contact{" "}
      {clinic.contactName ?? "the applicant"} at {clinic.contactEmail ?? "—"}{" "}
      yourself.
    </p>
  );
}

// After approval the next step is to give the clinic an administrator, who
// can then create everyone else. Prefilled from the application.
function ApprovedPanel({
  clinic,
  email,
  onDone,
}: {
  clinic: ClinicRecord;
  email: EmailResult | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fullName: clinic.contactName ?? "",
    username: suggestUsername(clinic.contactEmail ?? ""),
    email: clinic.contactEmail ?? "",
  });
  const [created, setCreated] = useState(false);

  const assign = useMutation({
    mutationFn: () =>
      assignClinicAdmin({
        username: form.username,
        email: form.email,
        fullName: form.fullName,
        clinicId: clinic.clinicId,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error || "Could not create the admin account");
        return;
      }
      setCreated(true);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(`Admin account created for ${form.fullName}`);
    },
    onError: () => toast.error("Could not create the admin account"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.fullName.trim() ||
      !form.username.trim() ||
      !isValidEmail(form.email)
    ) {
      toast.error("Enter a name, a username and a valid email address");
      return;
    }
    assign.mutate();
  };

  return (
    <div className="mt-5">
      <div className="rounded-lg border border-green-300 bg-green-50 p-4">
        <p className="text-sm font-semibold text-green-900">
          Approved: {clinic.clinicName} is now live
        </p>
        <EmailStatus
          email={email}
          clinic={clinic}
          sentText="The approval email was sent to"
          failedLead="The approval email was not sent"
        />
      </div>

      <div className="mt-5 border rounded-lg p-4">
        <p className="text-sm font-semibold">Create the clinic's admin</p>
        <p className="text-xs text-muted-foreground mb-3">
          The admin can then add the clinic's staff. They set their own password
          from an email, so you never see it.
        </p>
        {created ? (
          <p className="text-sm text-green-800">
            Admin account created for {form.fullName}. A password-setup email
            was requested for {form.email}.
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-3">
            <LabelledInput
              label="Full name"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
            />
            <LabelledInput
              label="Username"
              value={form.username}
              onChange={(v) =>
                setForm({ ...form, username: v.toLowerCase().trim() })
              }
            />
            <LabelledInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <button
              type="submit"
              disabled={assign.isPending}
              className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-sm disabled:opacity-60"
            >
              {assign.isPending ? "Creating…" : "Create admin account"}
            </button>
          </form>
        )}
      </div>

      <button
        onClick={onDone}
        className="w-full mt-4 border py-2 rounded-md text-sm"
      >
        {created ? "Done" : "Skip for now"}
      </button>
      {!created && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          You can create the admin later from Facilities → Assign Admin.
        </p>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  note,
}: {
  label: string;
  value?: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wider text-muted-foreground">
        {label.toUpperCase()}
      </dt>
      <dd className="text-sm break-words">{value || "—"}</dd>
      {note && <p className="text-[11px] text-amber-800 mt-0.5">{note}</p>}
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground block mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
    </label>
  );
}
