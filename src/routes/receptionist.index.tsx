import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { UserCircle2, CalendarPlus, MessageCircle, Plus, AlertTriangle, ArrowRight, CheckCircle, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNow } from "@/lib/store";

import type { QueueEntry, TriageLevel } from "@/lib/clinic-data";

export const Route = createFileRoute("/receptionist/")({
  component: ReceptionDashboard,
  ssr: false,
});

const TRIAGE_COLORS: Record<TriageLevel, string> = {
  red: "bg-red-600 text-white",
  orange: "bg-orange-500 text-white",
  yellow: "bg-yellow-400 text-black",
  green: "bg-green-500 text-white",
};

const TRIAGE_LABELS: Record<TriageLevel, string> = {
  red: "Critical — Immediate",
  orange: "Emergent — 10 min",
  yellow: "Urgent — 30 min",
  green: "Less Urgent — 60 min",
};

const TRIAGE_MAX_WAIT_MINUTES: Record<TriageLevel, number> = {
  red: 0,
  orange: 10,
  yellow: 30,
  green: 60,
};

type LogEntry = { ts: string; msg: string; type: "info" | "warn" | "critical" };

let clinicData: typeof import("@/lib/clinic-data") | null = null;
async function getClinicData() {
  if (!clinicData) clinicData = await import("@/lib/clinic-data");
  return clinicData;
}

function ReceptionDashboard() {
  const navigate = useNavigate();
  const now = useNow(60_000);

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState(false);
  const [clinicReady, setClinicReady] = useState(false);
  const [auditLog, setAuditLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    getClinicData().then(() => setClinicReady(true));
  }, []);

  // Live queue subscription
  useEffect(() => {
    if (!clinicReady) return;
    let unsubscribe: (() => void) | undefined;
    getClinicData().then(({ subscribeQueue }) => {
      unsubscribe = subscribeQueue(
        (rows) => setQueue(rows),
        () => setQueueError(true)
      );
    });
    return () => unsubscribe?.();
  }, [clinicReady]);

  // Fetch recent audit events on load
  useEffect(() => {
    if (!clinicReady) return;
    getClinicData().then(({ fetchQueueAudit }) => {
      fetchQueueAudit(undefined, 20).then((events) => {
        setAuditLog(
          events.map((e) => ({
            ts: e.timestamp?.toDate?.()
              ? e.timestamp.toDate().toISOString()
              : new Date().toISOString(),
            msg: `${e.action.toUpperCase()}: ${e.patientId} — ${e.details}`,
            type: e.action === "handoff" ? "warn" : e.triage === "red" ? "critical" : "info",
          }))
        );
      });
    });
  }, [clinicReady]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    patientId: "",
    reason: "",
    clinician: "",
    triage: "yellow" as TriageLevel,
  });
  const [busy, setBusy] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);

  const { data: appointments = [] } = useQuery({
    queryKey: ["recent-appointments"],
    queryFn: async () => {
      const { fetchRecentAppointments } = await getClinicData();
      return fetchRecentAppointments();
    },
    enabled: clinicReady,
  });

  // Acute care filtering
  const active = queue.filter((q) => q.status !== "done");
  const waiting = active.filter((q) => q.status === "waiting" || q.status === "called");
  const inProgress = active.filter((q) => q.status === "in-room" || q.status === "handoff");
  const criticalWaiting = waiting.filter((q) => q.triage === "red");

  // Escalation alerts
  useEffect(() => {
    if (!clinicReady) return;
    waiting.forEach((q) => {
      const waitMin = (now.getTime() - new Date(q.joinedAt).getTime()) / 60000;
      const maxWait = TRIAGE_MAX_WAIT_MINUTES[q.triage];
      if (waitMin > maxWait && q.status === "waiting") {
        toast.error(`${q.patientName} (${q.triage.toUpperCase()}) exceeded ${maxWait}min wait!`, {
          duration: 10000,
          id: `escalation-${q.id}`,
        });
        const entry: LogEntry = {
          ts: now.toISOString(),
          msg: `ESCALATION: ${q.patientId} (${q.triage.toUpperCase()}) exceeded ${maxWait}min wait`,
          type: "critical",
        };
        setAuditLog((l) => [entry, ...l].slice(0, 20));
      }
    });
  }, [waiting, now, clinicReady]);

  const addWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim()) return toast.error("Patient ID is required");
    setBusy(true);
    const { addToQueue } = await getClinicData();
    const { getUserFacility } = await import("@/lib/auth");
    const res = await addToQueue({
      patientId: draft.patientId,
      reason: draft.reason,
      clinician: draft.clinician || undefined,
      triage: draft.triage,
      facilityId: getUserFacility(),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not add to queue");
    toast.success(`${draft.patientId} added — ${TRIAGE_LABELS[draft.triage]}`);
    setDraft({ patientId: "", reason: "", clinician: "", triage: "yellow" });
    setAdding(false);
  };

  const notifyNext = async () => {
    const next = waiting[0];
    if (!next) return toast.info("No patients waiting");
    setBusy(true);
    try {
      const { callPatient } = await getClinicData();
      const { nextAllowed } = await import("@/lib/notifications-queue");
      const deliverAt = nextAllowed(now);
      await callPatient(next, deliverAt);
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        msg: `Called ${next.patientName} (${next.triage.toUpperCase()}) → ${next.clinician || "triage"}`,
        type: "info",
      };
      setAuditLog((l) => [entry, ...l].slice(0, 20));
      toast.success(`${next.patientName} called — proceed to ${next.clinician || "triage"}`);
    } catch {
      toast.error("Could not notify patient");
    } finally {
      setBusy(false);
    }
  };

  const handleHandoff = async (entryId: string, targetClinician: string) => {
    if (!targetClinician.trim()) return toast.error("Enter target clinician");
    setBusy(true);
    const { handoffPatient } = await getClinicData();
    const res = await handoffPatient(entryId, targetClinician);
    setHandoffTarget(null);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Handoff failed");
    toast.success(`Handed off to ${targetClinician}`);
  };

  const handleAcceptHandoff = async (entryId: string, clinicianId: string) => {
    setBusy(true);
    const { acceptHandoff } = await getClinicData();
    const res = await acceptHandoff(entryId, clinicianId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Accept failed");
    toast.success("Handoff accepted — patient is now yours");
  };

  const handleSetQueueStatus = async (id: string, status: QueueEntry["status"]) => {
    const { setQueueStatus } = await getClinicData();
    await setQueueStatus(id, status);
  };

  const handleRemoveFromQueue = async (id: string) => {
    const { removeFromQueue } = await getClinicData();
    await removeFromQueue(id);
  };

  const getWaitTime = (joinedAt: string) => {
    return Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 60000);
  };

  const isOverdue = (q: QueueEntry) => {
    const waitMin = getWaitTime(q.joinedAt);
    return waitMin > TRIAGE_MAX_WAIT_MINUTES[q.triage];
  };

  if (!clinicReady) {
    return (
      <AppShell role="receptionist" title="Reception Dashboard" showBack={false}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading queue system...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell role="receptionist" title="Reception Dashboard" showBack={false}>
      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Stat label="WAITING" value={String(waiting.length)} sub="Acute queue" />
        <Stat label="IN PROGRESS" value={String(inProgress.length)} sub="With clinician" />
        <Stat
          label="RED TRIAGE"
          value={String(criticalWaiting.length)}
          sub="Critical"
          alert={criticalWaiting.length > 0}
        />
        <Stat label="LAST UPDATED" value={now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} sub="Live" />
      </div>

      {/* Critical Alert Banner */}
      {criticalWaiting.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{criticalWaiting.length} critical patient(s)</strong> waiting immediate attention
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ACUTE CARE QUEUE PANEL */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">Acute Care Queue</h3>
              <p className="text-xs text-muted-foreground">Triage-based priority with handoff tracking</p>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1 border text-xs px-2.5 py-1.5 rounded-md hover:bg-secondary"
              >
                <Plus size={12} /> Add Walk-in
              </button>
              <button
                onClick={notifyNext}
                disabled={busy || waiting.length === 0}
                className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white text-xs px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
              >
                <MessageCircle size={12} /> Call Next
              </button>
            </div>
          </div>

          {/* Add walk-in form */}
          {adding && (
            <form onSubmit={addWalkIn} className="mb-3 p-3 rounded-md bg-secondary/40 border space-y-2">
              <input
                value={draft.patientId}
                onChange={(e) => setDraft({ ...draft, patientId: e.target.value })}
                placeholder="Patient ID (e.g. Pat-3)"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm font-mono"
              />
              <input
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="Reason for visit"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm"
              />
              <input
                value={draft.clinician}
                onChange={(e) => setDraft({ ...draft, clinician: e.target.value })}
                placeholder="Assign clinician (optional)"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm font-mono"
              />
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Triage Level</label>
                <div className="flex gap-2">
                  {(["red", "orange", "yellow", "green"] as TriageLevel[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDraft({ ...draft, triage: t })}
                      className={`text-[10px] px-2 py-1 rounded uppercase font-bold ${
                        draft.triage === t ? TRIAGE_COLORS[t] : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAdding(false)} className="flex-1 border py-1.5 rounded-md text-xs">Cancel</button>
                <button type="submit" disabled={busy} className="flex-1 bg-[oklch(0.55_0.18_245)] text-white py-1.5 rounded-md text-xs disabled:opacity-60">
                  {busy ? "Adding..." : "Add to queue"}
                </button>
              </div>
            </form>
          )}

          {queueError && (
            <p className="text-xs text-destructive mb-2">Could not load live queue.</p>
          )}

          {/* Queue list */}
          <ul className="space-y-2">
            {active.length === 0 ? (
              <li className="text-sm text-muted-foreground py-4 text-center">Queue is empty</li>
            ) : active.map((q) => {
              const waitMin = getWaitTime(q.joinedAt);
              const overdue = isOverdue(q);
              const rowBg = overdue && q.status === "waiting"
                ? "bg-red-50 border-red-200"
                : q.status === "called"
                  ? "bg-blue-50 border-blue-200"
                  : q.status === "handoff"
                    ? "bg-purple-50 border-purple-200"
                    : "hover:bg-secondary/40";

              return (
                <li key={q.id} className={`flex items-center gap-3 p-3 rounded-md border ${rowBg}`}>
                  {/* Triage badge */}
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${TRIAGE_COLORS[q.triage]}`}>
                    {q.triage === "red" ? "!" : q.triage[0].toUpperCase()}
                  </span>

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{q.patientName}</p>
                      {overdue && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                      {q.status === "handoff" && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                          Handoff
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {[q.patientId, q.reason].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Wait: {waitMin}min · {TRIAGE_LABELS[q.triage]}
                      {q.clinician && ` · Assigned: ${q.clinician}`}
                      {q.handedOffTo && ` → Handoff to: ${q.handedOffTo}`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[10px] uppercase tracking-wider font-medium ${
                      q.status === "waiting" && overdue ? "text-red-600" : "text-muted-foreground"
                    }`}>
                      {q.status === "handoff" ? `Handoff → ${q.handedOffTo}` : q.status}
                    </span>
                    <div className="flex gap-1">
                      {q.status === "waiting" && (
                        <>
                          <button onClick={() => handleSetQueueStatus(q.id, "called")} className="text-[11px] bg-blue-600 text-white px-2 py-0.5 rounded">Call</button>
                          <button onClick={() => handleSetQueueStatus(q.id, "in-room")} className="text-[11px] border px-2 py-0.5 rounded hover:bg-secondary">Skip call</button>
                        </>
                      )}
                      {q.status === "called" && (
                        <button onClick={() => handleSetQueueStatus(q.id, "in-room")} className="text-[11px] border px-2 py-0.5 rounded hover:bg-secondary">In room</button>
                      )}
                      {q.status === "in-room" && (
                        <>
                          {handoffTarget === q.id ? (
                            <div className="flex gap-1">
                              <input
                                autoFocus
                                placeholder="To clinician"
                                className="w-20 text-[11px] border rounded px-1"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleHandoff(q.id, e.currentTarget.value);
                                  if (e.key === "Escape") setHandoffTarget(null);
                                }}
                              />
                            </div>
                          ) : (
                            <>
                              <button onClick={() => setHandoffTarget(q.id)} className="text-[11px] flex items-center gap-0.5 bg-purple-600 text-white px-2 py-0.5 rounded">
                                <ArrowRight size={10} /> Handoff
                              </button>
                              <button onClick={() => handleSetQueueStatus(q.id, "done")} className="text-[11px] border px-2 py-0.5 rounded hover:bg-secondary">Done</button>
                            </>
                          )}
                        </>
                      )}
                      {q.status === "handoff" && (
                        <>
                          <button
                            onClick={() => handleAcceptHandoff(q.id, q.handedOffTo || "")}
                            disabled={!q.handedOffTo}
                            className="text-[11px] flex items-center gap-0.5 bg-green-600 text-white px-2 py-0.5 rounded disabled:opacity-50"
                          >
                            <CheckCircle size={10} /> Accept
                          </button>
                          <button onClick={() => handleSetQueueStatus(q.id, "in-room")} className="text-[11px] border px-2 py-0.5 rounded hover:bg-secondary">Cancel</button>
                        </>
                      )}
                      <button onClick={() => handleRemoveFromQueue(q.id)} className="text-[11px] text-muted-foreground hover:text-destructive">×</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Activity log */}
          {auditLog.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardList size={12} className="text-muted-foreground" />
                <p className="text-[10px] tracking-wider text-muted-foreground">AUDIT LOG (persisted to Firestore)</p>
              </div>
              <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                {auditLog.map((l, i) => (
                  <li key={i} className={`${
                    l.type === "critical" ? "text-red-600 font-medium" :
                    l.type === "warn" ? "text-orange-600" : "text-muted-foreground"
                  }`}>
                    <span className="font-mono mr-2">{new Date(l.ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                    {l.msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Recent Appointments */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Recent Appointments</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Patient</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {appointments.slice(0, 10).map((a: any) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{a.date} {a.time}</td>
                    <td className="py-2">{a.patientName}</td>
                    <td className="py-2"><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
        <button onClick={() => navigate({ to: "/receptionist/registration" })} className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]">
          + New Registration
        </button>
        <Link to="/receptionist/profiles" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary bg-white">
          <UserCircle2 size={16} /> Patient Profiles
        </Link>
        <Link to="/receptionist/appointments" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary bg-white">
          <CalendarPlus size={16} /> Book Appointment
        </Link>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${alert ? "border-red-300 bg-red-50" : ""}`}>
      <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
