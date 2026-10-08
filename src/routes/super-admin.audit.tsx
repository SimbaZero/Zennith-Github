import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown, KeyRound, Search, UserX, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  AuditEmptyLine,
  AuditEventList,
  type AuditRow,
} from "@/components/AuditEventList";
import {
  AuditFlagsSection,
  AuditMiniStat,
  AuditSection,
  DeletionRequestSummaryRow,
} from "@/components/AuditPanels";
import { useLogs } from "@/lib/audit";
import { eventTime, phraseStaffLog } from "@/lib/audit-phrasing";
import {
  buildFlags,
  buildLoginHistory,
  type LoginHistoryEntry,
} from "@/lib/audit-insights";
import { useCurrentAdmin } from "@/lib/auth";
import { useDeletionRequests } from "@/lib/clinic-data";
import { useClinics } from "@/lib/super-admin-service";

export const Route = createFileRoute("/super-admin/audit")({
  component: SuperAdminAudit,
});

// Platform-wide, so more than the 200 the clinic admin's page loads: a burst of
// failed sign-ins shouldn't be pushed out of the window by ordinary activity.
const EVENT_WINDOW = 500;

// Their own key, so dismissing a flag here never hides one on the clinic
// admin's page (or the reverse) in the same browser.
const DISMISSED_KEY = "zennith_dismissed_flags_super";

// One set of buttons drives the whole page, as on the clinic admin's Audit Logs.
type Filter = "all" | "review" | "logins" | "deletions";

/** "Today at 14:32" / "Yesterday at 09:10" / "Thu 8 Oct at 16:02". */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dayStart = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round(
    (dayStart(new Date()) - dayStart(d)) / 86_400_000,
  );
  const day =
    diffDays === 0
      ? "Today"
      : diffDays === 1
        ? "Yesterday"
        : d.toLocaleDateString("en-ZA", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
  return `${day} at ${eventTime(iso)}`;
}

function SuperAdminAudit() {
  const { admin } = useCurrentAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);

  // Platform-wide: no clinicId, which useLogs treats as "everything" (that is
  // the Super Admin's view, per the note on useLogs in audit.ts).
  const { rows: logs, loading, error } = useLogs(undefined, EVENT_WINDOW);
  const { clinics } = useClinics();
  const { requests, loading: requestsLoading } = useDeletionRequests(
    undefined,
    { allClinics: true },
  );
  const clinicName = useMemo(
    () => new Map(clinics.map((c) => [c.clinicId, c.clinicName])),
    [clinics],
  );

  // Reviewed flags are dismissed per browser, never touching the underlying
  // record — same approach as the clinic admin's page.
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const dismissFlag = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — it just won't persist */
    }
  };

  // No queue events: this is the platform security view, not how a waiting room
  // ran (that is the clinic admin's page).
  const flags = useMemo(
    () => buildFlags([], logs, dismissed),
    [logs, dismissed],
  );
  const history = useMemo(() => buildLoginHistory(logs), [logs]);

  const needle = q.trim().toLowerCase();
  const visibleHistory = useMemo(
    () =>
      history.filter(
        (h) =>
          (!onlyFailed || h.failed > 0) &&
          (!needle ||
            h.actor.includes(needle) ||
            (h.lastRole ?? "").toLowerCase().includes(needle)),
      ),
    [history, onlyFailed, needle],
  );

  const removedRows: AuditRow[] = useMemo(
    () =>
      logs
        .filter((l) => l.action_type === "staff.remove")
        .map((l) => {
          const p = phraseStaffLog(l);
          const clinic =
            l.clinicId != null ? clinicName.get(l.clinicId) : undefined;
          return {
            id: l.id,
            when: l.timestamp,
            text: p.text,
            detail: [
              ...(clinic ? [`Clinic: ${clinic}`] : []),
              ...(p.detail ?? []),
            ],
          };
        })
        .filter(
          (r) =>
            !needle ||
            r.text.toLowerCase().includes(needle) ||
            r.detail.some((d) => d.toLowerCase().includes(needle)),
        ),
    [logs, clinicName, needle],
  );

  const visibleRequests = useMemo(
    () =>
      requests.filter(
        (r) =>
          !needle ||
          r.patientName.toLowerCase().includes(needle) ||
          r.patientId.toLowerCase().includes(needle) ||
          (r.clinicId != null &&
            (clinicName.get(r.clinicId) ?? "").toLowerCase().includes(needle)),
      ),
    [requests, clinicName, needle],
  );

  const now = Date.now();
  const dayAgo = (iso: string) => now - new Date(iso).getTime() < 86_400_000;
  const signIns24h = logs.filter(
    (l) => l.action_type === "auth.login_success" && dayAgo(l.timestamp),
  ).length;
  const failed24h = logs.filter(
    (l) => l.action_type === "auth.login_failed" && dayAgo(l.timestamp),
  ).length;
  const critical = flags.filter((f) => f.severity === "critical").length;

  const show = (section: Filter) => filter === "all" || filter === section;
  const filterButtons: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "Everything" },
    { key: "review", label: "Worth a look", count: flags.length },
    { key: "logins", label: "Sign-ins" },
    { key: "deletions", label: "Account deletions", count: requests.length },
  ];
  const searchable =
    filter === "all" || filter === "logins" || filter === "deletions";

  return (
    <AppShell
      role="super_admin"
      title="Security & Audit"
      staffNameOverride={admin?.fullName}
    >
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AuditMiniStat
          label="WORTH A LOOK"
          value={String(flags.length)}
          alert={critical > 0}
        />
        <AuditMiniStat label="SIGN-INS (24H)" value={String(signIns24h)} />
        <AuditMiniStat
          label="FAILED ATTEMPTS (24H)"
          value={String(failed24h)}
        />
        <AuditMiniStat
          label="DELETION REQUESTS"
          value={String(requests.length)}
        />
      </div>

      <div className="bg-white rounded-xl border p-4 mb-6">
        <p className="text-sm font-medium">Platform activity</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every clinic, based on the latest {EVENT_WINDOW} recorded events —
          older ones aren't included. Pick a section to focus on it, or show
          everything.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {filterButtons.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`text-sm px-3.5 py-2 rounded-full border inline-flex items-center gap-1.5 ${
                filter === key
                  ? "bg-[oklch(0.18_0.06_260)] text-white border-[oklch(0.18_0.06_260)]"
                  : "hover:bg-secondary"
              }`}
            >
              {label}
              {count != null && count > 0 && (
                <span
                  className={`text-xs px-1.5 rounded-full ${
                    filter === key
                      ? "bg-white/20"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
        {searchable && (
          <div className="relative mt-3 sm:max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a person or login name…"
              className="border rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-full"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load the audit log: {error}
        </div>
      )}

      <div className="space-y-6">
        {show("review") && (
          <AuditFlagsSection
            flags={flags}
            onDismiss={dismissFlag}
            note="Failed sign-ins are only recorded once the password has been accepted, so this currently sees wrong two-factor codes. A wrong password can't be recorded yet — nobody is signed in at that point — so an empty list does not mean nobody has been guessing passwords."
          />
        )}

        {show("logins") && (
          <AuditSection
            icon={
              <KeyRound size={16} className="text-[oklch(0.45_0.15_245)]" />
            }
            title="Sign-ins"
            count={visibleHistory.length}
            hint="Who has been signing in, when they last did, and failed attempts"
          >
            <div className="px-5 py-3 border-b">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer min-h-[32px]">
                <input
                  type="checkbox"
                  checked={onlyFailed}
                  onChange={(e) => setOnlyFailed(e.target.checked)}
                />
                Only people with failed attempts
              </label>
            </div>
            {loading ? (
              <AuditEmptyLine>Loading…</AuditEmptyLine>
            ) : visibleHistory.length === 0 ? (
              <AuditEmptyLine>
                {needle || onlyFailed
                  ? "Nobody matches that."
                  : "No sign-ins recorded yet."}
              </AuditEmptyLine>
            ) : (
              <ul className="divide-y">
                {visibleHistory.map((h) => (
                  <LoginHistoryRow key={h.actor} entry={h} />
                ))}
              </ul>
            )}
          </AuditSection>
        )}

        {show("deletions") && (
          <>
            <AuditSection
              icon={<Users size={16} className="text-[oklch(0.45_0.15_290)]" />}
              title="Staff accounts removed"
              count={removedRows.length}
              hint="Logins revoked, at any clinic"
            >
              {loading ? (
                <AuditEmptyLine>Loading…</AuditEmptyLine>
              ) : (
                <AuditEventList
                  rows={removedRows}
                  tone="staff"
                  empty={
                    needle
                      ? "Nothing matches your search."
                      : "No staff accounts have been removed."
                  }
                />
              )}
            </AuditSection>

            <AuditSection
              icon={<UserX size={16} className="text-amber-700" />}
              title="Patient deletion requests"
              count={visibleRequests.length}
              hint="Patients asking for their account and data to be deactivated, waiting for a response"
              tone={requests.length > 0 ? "amber" : "plain"}
            >
              {requestsLoading ? (
                <AuditEmptyLine>Loading…</AuditEmptyLine>
              ) : visibleRequests.length === 0 ? (
                <AuditEmptyLine>
                  {needle
                    ? "Nothing matches your search."
                    : "No deletion requests are waiting."}
                </AuditEmptyLine>
              ) : (
                <ul className="divide-y">
                  {visibleRequests.map((r) => (
                    <DeletionRequestSummaryRow
                      key={r.patientId}
                      request={r}
                      clinicName={
                        r.clinicId != null
                          ? clinicName.get(r.clinicId)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </AuditSection>
          </>
        )}
      </div>
    </AppShell>
  );
}

/** One person: name, last sign-in, failed-attempt count. Opens to their events. */
function LoginHistoryRow({ entry }: { entry: LoginHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const rows: AuditRow[] = useMemo(
    () =>
      entry.events.map((e) => ({
        id: e.id,
        when: e.timestamp,
        text: phraseStaffLog(e).text,
        detail: [],
        emphasis: e.action_type === "auth.login_failed" ? "warn" : undefined,
      })),
    [entry.events],
  );
  const hasRecentFailures = entry.failed24h > 0;

  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-5 py-3 hover:bg-secondary/40 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-all">
            {entry.actor}
            {entry.lastRole && (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {entry.lastRole.replace(/_/g, " ")}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entry.lastSignIn
              ? `Last signed in ${whenLabel(entry.lastSignIn)}`
              : "No successful sign-in in this window"}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${
            hasRecentFailures
              ? "bg-amber-50 text-amber-900 border-amber-300"
              : entry.failed > 0
                ? "bg-secondary text-foreground"
                : "text-muted-foreground"
          }`}
        >
          {entry.failed} failed
        </span>
        <ChevronDown
          size={14}
          className={`mt-1.5 shrink-0 text-muted-foreground transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t bg-secondary/20">
          <AuditEventList rows={rows} tone="staff" empty="No events." />
        </div>
      )}
    </li>
  );
}
