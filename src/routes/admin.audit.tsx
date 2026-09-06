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
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Search,
  Users,
  ClipboardList,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { buildFlags, buildStats, type Flag } from "@/lib/audit-insights";
import type { QueueAuditEvent } from "@/lib/clinic-data";

export const Route = createFileRoute("/admin/audit")({ component: AdminAudit });

type Row = {
  id: string;
  when: string;
  source: "staff" | "queue";
  who: string;
  what: string;
  detail: string;
};

function AdminAudit() {
  const { admin } = useCurrentAdmin();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "staff" | "queue">("all");

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
  useEffect(() => {
    if (admin?.clinicId == null) return;
    const unsub = subscribeQueueAudit(
      (events) => {
        setRawQueue(events);
        setQueueRows(
          events.map((e) => ({
            id: e.id ?? `${e.entryId}-${e.action}`,
            when: e.timestamp?.toDate?.()
              ? e.timestamp.toDate().toISOString()
              : new Date().toISOString(),
            source: "queue" as const,
            who: e.by || "—",
            what: e.action,
            detail: `${e.patientId} — ${e.details}`,
          })),
        );
      },
      () => setQueueRows([]),
      String(admin.clinicId),
      100,
    );
    return () => unsub();
  }, [admin?.clinicId]);

  const allRows: Row[] = useMemo(() => {
    const staff: Row[] = staffLogs.map((l) => ({
      id: l.id,
      when: l.timestamp,
      source: "staff" as const,
      who: l.actor_id,
      what: l.action_type,
      detail: l.description,
    }));
    return [...staff, ...queueRows].sort(
      (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
    );
  }, [staffLogs, queueRows]);

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

  const rows = useMemo(() => {
    let out = allRows;
    if (filter !== "all") out = out.filter((r) => r.source === filter);
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter(
        (r) =>
          r.detail.toLowerCase().includes(needle) ||
          r.who.toLowerCase().includes(needle) ||
          r.what.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [allRows, filter, q]);

  // Group by day so a long list reads as a timeline rather than a wall.
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const day = new Date(r.when).toLocaleDateString("en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <AppShell
      role="admin"
      title="Audit Logs"
      staffNameOverride={admin?.fullName}
      clinicNameOverride={admin?.clinicName}
    >
      {/* Patients can request account deactivation under POPIA. Previously
          those requests were written to the patient's own browser and no
          admin ever saw them, while the patient was told an admin had been
          notified. */}
      {deletionRequests.length > 0 && (
        <div className="mb-6 bg-white rounded-xl border border-amber-300 overflow-hidden">
          <div className="px-5 py-3 border-b bg-amber-50 flex items-center gap-2">
            <UserX size={15} className="text-amber-700" />
            <h3 className="font-semibold text-sm text-amber-900">
              Data deletion requests
            </h3>
            <span className="text-xs text-amber-800 ml-auto">
              {deletionRequests.length} awaiting response
            </span>
          </div>
          <ul className="divide-y">
            {deletionRequests.map((r) => (
              <DeletionRequestRow
                key={r.patientId}
                request={r}
                actor={admin?.fullName ?? admin?.username ?? "admin"}
              />
            ))}
          </ul>
        </div>
      )}

      <InsightsPanel flags={flags} stats={stats} onDismiss={dismissFlag} />

      <div className="bg-white rounded-xl border">
        <div className="p-5 border-b">
          <div className="flex items-center gap-3 flex-wrap">
            <ShieldCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
            <div>
              <h3 className="font-semibold">
                Activity at {admin?.clinicName ?? "your clinic"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Staff account changes and patient queue events, newest first.
              </p>
            </div>
            <div className="relative ml-auto">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search patient, staff or action…"
                className="border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            {(
              [
                ["all", "Everything"],
                ["queue", "Patient queue"],
                ["staff", "Staff accounts"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-xs px-3 py-1.5 rounded-full border ${
                  filter === key
                    ? "bg-[oklch(0.18_0.06_260)] text-white border-[oklch(0.18_0.06_260)]"
                    : "hover:bg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="text-xs text-muted-foreground self-center ml-auto">
              {staffLoading ? "Loading…" : `${rows.length} events`}
            </span>
          </div>
        </div>

        {error ? (
          <div className="p-5 text-sm text-destructive">
            Couldn't load the audit log: {error}
            <p className="text-xs text-muted-foreground mt-2">
              If this mentions an index, open your browser console (F12) —
              Firebase prints a link that creates it in one click.
            </p>
          </div>
        ) : grouped.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {q.trim()
              ? "Nothing matches your search."
              : "No activity recorded yet."}
          </p>
        ) : (
          <div className="divide-y">
            {grouped.map(([day, dayRows]) => (
              <div key={day}>
                <div className="px-5 py-2 bg-secondary/40 sticky top-0">
                  <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    {day}
                  </p>
                </div>
                <ul className="divide-y">
                  {dayRows.map((r) => (
                    <li
                      key={r.id}
                      className="px-5 py-3 flex items-start gap-3 hover:bg-secondary/30"
                    >
                      <span
                        className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          r.source === "queue"
                            ? "bg-[oklch(0.95_0.05_245)] text-[oklch(0.45_0.15_245)]"
                            : "bg-[oklch(0.95_0.04_290)] text-[oklch(0.45_0.15_290)]"
                        }`}
                      >
                        {r.source === "queue" ? (
                          <ClipboardList size={13} />
                        ) : (
                          <Users size={13} />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{r.detail}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(r.when).toLocaleTimeString("en-ZA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" · "}
                          <span className="capitalize">{r.what}</span>
                          {" · by "}
                          {r.who}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
function InsightsPanel({
  flags,
  stats,
  onDismiss,
}: {
  flags: Flag[];
  stats: ReturnType<typeof buildStats>;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const critical = flags.filter((f) => f.severity === "critical").length;

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat
          label="NEEDS ATTENTION"
          value={String(flags.length)}
          alert={critical > 0}
        />
        <MiniStat
          label="PATIENTS CALLED"
          value={String(stats.patientsCalled)}
        />
        <MiniStat
          label="BUSIEST HOUR"
          value={stats.busiestHour != null ? `${stats.busiestHour}:00` : "—"}
        />
        <MiniStat label="QUEUE EVENTS" value={String(stats.totalEvents)} />
      </div>

      {flags.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-600" />
            <h3 className="font-semibold text-sm">Worth looking at</h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {flags.length} flagged
            </span>
          </div>
          <ul className="divide-y">
            {flags.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => setOpen(open === f.id ? null : f.id)}
                  className="w-full text-left px-5 py-3 hover:bg-secondary/40 flex items-start gap-3"
                >
                  <span
                    className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
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
                    <p className="text-[10px] tracking-wider text-muted-foreground mb-2">
                      WHAT HAPPENED
                    </p>
                    <ol className="border-l-2 pl-4 space-y-2">
                      {f.evidence.map((e, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono text-muted-foreground mr-2">
                            {new Date(e.when).toLocaleTimeString("en-ZA", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {e.text}
                        </li>
                      ))}
                    </ol>
                    <button
                      onClick={() => onDismiss(f.id)}
                      className="mt-3 text-xs font-medium border px-3 py-1.5 rounded-md hover:bg-secondary"
                    >
                      Mark as reviewed
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
      <p className="text-[10px] tracking-wider text-muted-foreground">
        {label}
      </p>
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

  return (
    <li className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
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
            {days != null && days > 2 && (
              <span className="text-amber-700 font-medium">
                {" "}
                · overdue a response
              </span>
            )}
          </p>
          {request.reason && (
            <p className="text-xs mt-1.5 italic">"{request.reason}"</p>
          )}
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="text-xs font-medium border px-3 py-1.5 rounded-md hover:bg-secondary shrink-0"
          >
            Respond
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-md border bg-secondary/30 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Marking this handled does not delete anything — medical records must
            be retained for a legally defined period. Record what you actually
            did, including how the patient was contacted.
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
      )}
    </li>
  );
}
