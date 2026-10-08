import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useLogs } from "@/lib/audit";
import { useCurrentAdmin } from "@/lib/auth";
import {
  subscribeQueueAudit,
  useDeletionRequests,
  resolveDeletionRequest,
} from "@/lib/clinic-data";
import { toast } from "sonner";
import { UserX } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Search,
  Users,
  ClipboardList,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { buildFlags, buildStats, type Flag } from "@/lib/audit-insights";
import type { QueueAuditEvent } from "@/lib/clinic-data";
import {
  eventTime,
  phraseQueueEvent,
  phraseStaffLog,
} from "@/lib/audit-phrasing";
import {
  AuditEmptyLine,
  AuditEventList,
  type AuditRow,
} from "@/components/AuditEventList";

export const Route = createFileRoute("/admin/audit")({ component: AdminAudit });

type Row = AuditRow & { source: "staff" | "queue" };

// One set of buttons drives the whole page: each section below is shown when
// its button (or "Everything") is selected.
type Filter = "all" | "review" | "deletions" | "staff" | "queue";

function AdminAudit() {
  const { admin } = useCurrentAdmin();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Staff/account events (systemAudit) — scoped to this admin's clinic.
  const {
    rows: staffLogs,
    loading: staffLoading,
    error,
  } = useLogs(admin?.clinicId ?? null);

  // Patient queue events (queueAudit). These were previously visible ONLY to
  // reception, so an admin had no way to review how the queue actually ran —
  // arguably the thing they'd most want to look back on.
  const { requests: deletionRequests } = useDeletionRequests(admin?.clinicId);
  const [queueRows, setQueueRows] = useState<Row[]>([]);
  const [rawQueue, setRawQueue] = useState<QueueAuditEvent[]>([]);
  // Without this the empty message flashes before the first events arrive.
  const [queueLoading, setQueueLoading] = useState(true);
  useEffect(() => {
    if (admin?.clinicId == null) return;
    const unsub = subscribeQueueAudit(
      (events) => {
        setRawQueue(events);
        setQueueRows(
          events.map((e) => {
            const p = phraseQueueEvent(e);
            return {
              id: e.id ?? `${e.entryId}-${e.action}`,
              when: e.timestamp?.toDate?.()
                ? e.timestamp.toDate().toISOString()
                : new Date().toISOString(),
              source: "queue" as const,
              text: p.text,
              detail: p.detail ?? [],
            };
          }),
        );
        setQueueLoading(false);
      },
      () => {
        setQueueRows([]);
        setQueueLoading(false);
      },
      String(admin.clinicId),
      100,
    );
    return () => unsub();
  }, [admin?.clinicId]);

  const staffRows: Row[] = useMemo(
    () =>
      staffLogs.map((l) => {
        const p = phraseStaffLog(l);
        return {
          id: l.id,
          when: l.timestamp,
          source: "staff" as const,
          text: p.text,
          detail: p.detail ?? [],
        };
      }),
    [staffLogs],
  );

  // Reviewed flags are dismissed per-admin. Kept locally rather than in
  // Firestore: "I've looked at this" is one person's working state, not a
  // fact about the clinic, and it must never hide the underlying audit
  // entry — only the prompt to review it.
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        localStorage.getItem("zennith_dismissed_flags") ?? "[]",
      );
    } catch {
      return [];
    }
  });

  const dismissFlag = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem("zennith_dismissed_flags", JSON.stringify(next));
  };

  const flags = useMemo(
    () => buildFlags(rawQueue, staffLogs, dismissed),
    [rawQueue, staffLogs, dismissed],
  );
  const stats = useMemo(() => buildStats(rawQueue), [rawQueue]);

  const needle = q.trim().toLowerCase();
  const matches = (r: Row) =>
    !needle ||
    r.text.toLowerCase().includes(needle) ||
    r.detail.some((d) => d.toLowerCase().includes(needle));
  const visibleStaff = useMemo(
    () => staffRows.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staffRows, needle],
  );
  const visibleQueue = useMemo(
    () => queueRows.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueRows, needle],
  );

  const show = (section: Filter) => filter === "all" || filter === section;

  const filterButtons: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "Everything" },
    { key: "review", label: "Worth a look", count: flags.length },
    {
      key: "deletions",
      label: "Deletion requests",
      count: deletionRequests.length,
    },
    { key: "staff", label: "Staff account changes" },
    { key: "queue", label: "Patient queue activity" },
  ];
  // The search box only means something for the two activity lists.
  const searchable =
    filter === "all" || filter === "staff" || filter === "queue";

  return (
    <AppShell
      role="admin"
      title="Audit Logs"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      <StatsStrip flags={flags} stats={stats} />

      <div className="bg-white rounded-xl border p-4 mb-6">
        <p className="text-sm font-medium">
          Activity at {admin?.clinicName ?? "your clinic"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pick a section to focus on it, or show everything. Newest first.
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
              placeholder="Search a patient ID, person or action…"
              className="border rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-full"
            />
          </div>
        )}
      </div>

      <div className="space-y-6">
        {show("review") && (
          <FlagsSection flags={flags} onDismiss={dismissFlag} />
        )}

        {/* Patients can request account deactivation under POPIA. Previously
            those requests were written to the patient's own browser and no
            admin ever saw them, while the patient was told an admin had been
            notified. */}
        {show("deletions") && (
          <Section
            icon={<UserX size={16} className="text-amber-700" />}
            title="Deletion requests"
            count={deletionRequests.length}
            hint="Patients asking for their account and data to be deactivated"
            tone={deletionRequests.length > 0 ? "amber" : "plain"}
          >
            {deletionRequests.length === 0 ? (
              <AuditEmptyLine>No deletion requests are waiting.</AuditEmptyLine>
            ) : (
              <ul className="divide-y">
                {deletionRequests.map((r) => (
                  <DeletionRequestRow
                    key={r.patientId}
                    request={r}
                    actor={admin?.fullName ?? admin?.username ?? "admin"}
                  />
                ))}
              </ul>
            )}
          </Section>
        )}

        {show("staff") && (
          <Section
            icon={<Users size={16} className="text-[oklch(0.45_0.15_290)]" />}
            title="Staff account changes"
            count={visibleStaff.length}
            hint="Logins created, updated or removed, and other changes to people and records"
          >
            {error ? (
              <div className="p-5 text-sm text-destructive">
                Couldn't load the audit log: {error}
                <p className="text-xs text-muted-foreground mt-2">
                  If this mentions an index, open your browser console (F12) —
                  Firebase prints a link that creates it in one click.
                </p>
              </div>
            ) : staffLoading ? (
              <AuditEmptyLine>Loading…</AuditEmptyLine>
            ) : (
              <AuditEventList
                rows={visibleStaff}
                tone="staff"
                empty={
                  needle
                    ? "Nothing matches your search."
                    : "No staff account changes recorded yet."
                }
              />
            )}
          </Section>
        )}

        {show("queue") && (
          <Section
            icon={
              <ClipboardList
                size={16}
                className="text-[oklch(0.45_0.15_245)]"
              />
            }
            title="Patient queue activity"
            count={visibleQueue.length}
            hint="How the waiting room ran — who was added, called, moved or removed"
          >
            {queueLoading ? (
              <AuditEmptyLine>Loading…</AuditEmptyLine>
            ) : (
              <AuditEventList
                rows={visibleQueue}
                tone="queue"
                empty={
                  needle
                    ? "Nothing matches your search."
                    : "No queue activity recorded yet."
                }
              />
            )}
          </Section>
        )}
      </div>
    </AppShell>
  );
}

/** A titled, bordered block — every part of the page uses this so the
 *  sections read as separate things rather than one long list. */
function Section({
  icon,
  title,
  count,
  hint,
  tone = "plain",
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  hint: string;
  tone?: "plain" | "amber";
  children: ReactNode;
}) {
  return (
    <section
      className={`bg-white rounded-xl border overflow-hidden ${
        tone === "amber" ? "border-amber-300" : ""
      }`}
    >
      <div
        className={`px-5 py-3 border-b flex flex-wrap items-center gap-x-2 gap-y-0.5 ${
          tone === "amber" ? "bg-amber-50" : ""
        }`}
      >
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5 bg-white">
          {count}
        </span>
        <p className="basis-full sm:basis-auto sm:ml-2 text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      {children}
    </section>
  );
}

function StatsStrip({
  flags,
  stats,
}: {
  flags: Flag[];
  stats: ReturnType<typeof buildStats>;
}) {
  const critical = flags.filter((f) => f.severity === "critical").length;
  return (
    <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <MiniStat
        label="WORTH A LOOK"
        value={String(flags.length)}
        alert={critical > 0}
      />
      <MiniStat label="PATIENTS CALLED" value={String(stats.patientsCalled)} />
      <MiniStat
        label="BUSIEST HOUR"
        value={stats.busiestHour != null ? `${stats.busiestHour}:00` : "—"}
      />
      <MiniStat label="QUEUE EVENTS" value={String(stats.totalEvents)} />
    </div>
  );
}

/**
 * Things that may be worth reviewing — a long wait for a critical patient, a
 * handoff nobody picked up. These are prompts to look, not findings that
 * anything went wrong. "Mark as reviewed" only hides the prompt for this admin;
 * it never touches the underlying record.
 */
function FlagsSection({
  flags,
  onDismiss,
}: {
  flags: Flag[];
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section
      icon={<AlertTriangle size={16} className="text-amber-600" />}
      title="Worth a look"
      count={flags.length}
      hint="Things that may be worth reviewing — not a sign that anything went wrong"
    >
      {flags.length === 0 ? (
        <AuditEmptyLine>Nothing needs a look right now.</AuditEmptyLine>
      ) : (
        <ul className="divide-y">
          {flags.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => setOpen(open === f.id ? null : f.id)}
                aria-expanded={open === f.id}
                className="w-full text-left px-5 py-3 hover:bg-secondary/40 flex items-start gap-3"
              >
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    f.severity === "critical" ? "bg-red-600" : "bg-amber-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {f.detail}
                  </p>
                </div>
                <ChevronDown
                  size={14}
                  className={`mt-1 shrink-0 text-muted-foreground transition ${
                    open === f.id ? "rotate-180" : ""
                  }`}
                />
              </button>
              {open === f.id && (
                <div className="px-5 pb-4 pl-10">
                  <p className="text-xs tracking-wider text-muted-foreground mb-2">
                    WHAT HAPPENED
                  </p>
                  <ol className="border-l-2 pl-4 space-y-2">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono text-muted-foreground mr-2">
                          {eventTime(e.when)}
                        </span>
                        {e.text}
                      </li>
                    ))}
                  </ol>
                  <button
                    onClick={() => onDismiss(f.id)}
                    className="mt-3 text-xs font-medium border px-3 py-2 rounded-md hover:bg-secondary"
                  >
                    Mark as reviewed
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MiniStat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-4 ${alert ? "border-red-300 bg-red-50" : ""}`}
    >
      <p className="text-xs tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}
function DeletionRequestRow({
  request,
  actor,
}: {
  request: {
    patientId: string;
    patientName: string;
    requestedAt: string;
    reason?: string;
  };
  actor: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async (outcome: "actioned" | "declined") => {
    if (!note.trim()) {
      toast.error("Record what you did — this is a legal request.");
      return;
    }
    setBusy(true);
    try {
      await resolveDeletionRequest(
        request.patientId,
        outcome,
        note.trim(),
        actor,
      );
      toast.success(`Request marked ${outcome}`);
      setOpen(false);
      setNote("");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const when = new Date(request.requestedAt);
  const days = Number.isNaN(when.getTime())
    ? null
    : Math.floor((Date.now() - when.getTime()) / 86_400_000);

  const overdue = days != null && days > 2;

  return (
    <li>
      {/* The summary is the whole row: how long it has waited is what matters
          at a glance. The stated reason and the response form open on click. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left p-5 hover:bg-secondary/40 flex items-start gap-3"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {request.patientName}{" "}
            <span className="text-muted-foreground font-normal">
              · {request.patientId}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Requested{" "}
            {days == null
              ? "—"
              : days === 0
                ? "today"
                : days === 1
                  ? "yesterday"
                  : `${days} days ago`}
            {overdue && (
              <span className="text-amber-700 font-medium">
                {" "}
                · overdue a response
              </span>
            )}
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1 shrink-0 mt-0.5">
          {open ? "Close" : "Respond"}
          <ChevronDown
            size={14}
            className={`transition ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          <div>
            <p className="text-xs tracking-wider text-muted-foreground mb-1">
              REASON GIVEN
            </p>
            {request.reason ? (
              <p className="text-sm italic">"{request.reason}"</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The patient didn't give a reason.
              </p>
            )}
          </div>

          <div className="rounded-md border bg-secondary/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">
              Marking this handled does not delete anything — medical records
              must be retained for a legally defined period. Record what you
              actually did, including how the patient was contacted. This note
              is internal — the patient is sent a standard message about the
              outcome.
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. called patient, account deactivated, records retained until 2031"
              className="w-full border rounded-md px-3 py-2 text-sm bg-white"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 border bg-white py-2 rounded-md text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => resolve("declined")}
                disabled={busy}
                className="flex-1 border bg-white py-2 rounded-md text-xs disabled:opacity-60"
              >
                Decline
              </button>
              <button
                onClick={() => resolve("actioned")}
                disabled={busy}
                className="flex-1 bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-xs disabled:opacity-60"
              >
                {busy ? "Saving…" : "Mark handled"}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
