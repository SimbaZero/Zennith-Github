import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { UserCircle2, CalendarPlus, MessageCircle, Plus, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { nextAllowed } from "@/lib/notifications-queue";
import { toast } from "sonner";
import { useNow } from "@/lib/store";
import { getUserFacility } from "@/lib/auth";
import {
  subscribeQueue, addToQueue, callPatient, setQueueStatus, removeFromQueue,
  fetchRecentAppointments, type QueueEntry,
} from "@/lib/clinic-data";

export const Route = createFileRoute("/receptionist/")({ component: ReceptionDashboard });

function ReceptionDashboard() {
  const navigate = useNavigate();
  const now = useNow(60_000);

  // Live shared queue — updates the instant any screen changes it.
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState(false);
  useEffect(() => subscribeQueue(setQueue, () => setQueueError(true)), []);

  const [log, setLog] = useState<Array<{ ts: string; msg: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ patientId: "", reason: "", clinician: "", urgent: false });
  const [busy, setBusy] = useState(false);

  const { data: appointments = [] } = useQuery({
    queryKey: ["recent-appointments"],
    queryFn: fetchRecentAppointments,
  });

  const waiting = queue.filter((q) => q.status === "waiting");
  const active = queue.filter((q) => q.status !== "done");

  const addWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.patientId.trim()) return toast.error("Patient ID is required (e.g. Pat-3)");
    setBusy(true);
    const res = await addToQueue({
      patientId: draft.patientId,
      reason: draft.reason,
      clinician: draft.clinician || undefined,
      priority: draft.urgent ? "urgent" : "normal",
      facilityId: getUserFacility(),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Could not add to queue");
    toast.success(`${draft.patientId} added to the queue`);
    setDraft({ patientId: "", reason: "", clinician: "", urgent: false });
    setAdding(false);
  };

  const notifyNext = async () => {
    const next = waiting[0];
    if (!next) return toast.info("No patients waiting");
    const when = new Date();
    const scheduled = nextAllowed(when);
    const sendsNow = scheduled.getTime() <= when.getTime();
    setBusy(true);
    try {
      await callPatient(next, scheduled);
      const msg = sendsNow
        ? `${next.patientName} notified — please proceed.`
        : `Queued for ${next.patientName} — outside 07:00–20:00; will deliver at ${scheduled.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}.`;
      setLog((l) => [{ ts: new Date().toISOString(), msg }, ...l].slice(0, 8));
      toast.success(msg);
    } catch {
      toast.error("Could not notify the patient");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell role="receptionist" title="Reception Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat label="RECENT APPOINTMENTS" value={String(appointments.length)} sub="Clinic-wide" />
        <Stat label="ACUTE QUEUE" value={String(waiting.length)} sub="Walk-ins waiting" />
        <Stat label="LAST UPDATED" value={now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} sub="Live" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Acute Walk-in Queue</h3>
            <div className="flex gap-1.5">
              <button
                onClick={() => setAdding((v) => !v)}
                className="flex items-center gap-1 border text-xs px-2.5 py-1.5 rounded-md hover:bg-secondary"
              >
                <Plus size={12} /> Add
              </button>
              <button
                onClick={notifyNext}
                disabled={busy || waiting.length === 0}
                className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white text-xs px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
              >
                <MessageCircle size={12} /> Call next
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Shared live with clinical staff. Alerts deliver 07:00–20:00; later ones are queued.
          </p>

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
                placeholder="Clinician (optional, e.g. Doc-2)"
                className="w-full border rounded-md px-2.5 py-1.5 text-sm font-mono"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.urgent}
                  onChange={(e) => setDraft({ ...draft, urgent: e.target.checked })}
                />
                Urgent — move to front of queue
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAdding(false)} className="flex-1 border py-1.5 rounded-md text-xs">Cancel</button>
                <button type="submit" disabled={busy} className="flex-1 bg-[oklch(0.55_0.18_245)] text-white py-1.5 rounded-md text-xs disabled:opacity-60">
                  {busy ? "Adding…" : "Add to queue"}
                </button>
              </div>
            </form>
          )}

          {queueError && (
            <p className="text-xs text-destructive mb-2">Could not load the live queue.</p>
          )}

          <ul className="space-y-1.5">
            {active.length === 0 ? (
              <li className="text-sm text-muted-foreground py-4 text-center">Queue is empty</li>
            ) : active.map((q, i) => (
              <li
                key={q.id}
                className={`flex items-center gap-3 p-2 rounded-md ${
                  q.status === "called" ? "bg-[oklch(0.97_0.03_245)] border border-[oklch(0.85_0.08_245)]" : "hover:bg-secondary/40"
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  q.priority === "urgent" ? "bg-[oklch(0.55_0.22_25)] text-white" : i === 0 ? "bg-[oklch(0.55_0.18_245)] text-white" : "bg-secondary"
                }`}>
                  {q.priority === "urgent" ? <AlertTriangle size={12} /> : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{q.patientName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {[q.patientId, q.clinician, q.reason].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{q.status}</span>
                <div className="flex gap-1 shrink-0">
                  {q.status === "called" && (
                    <button onClick={() => setQueueStatus(q.id, "in-room")} className="text-[11px] border px-1.5 py-0.5 rounded hover:bg-secondary">In room</button>
                  )}
                  {q.status === "in-room" && (
                    <button onClick={() => setQueueStatus(q.id, "done")} className="text-[11px] border px-1.5 py-0.5 rounded hover:bg-secondary">Done</button>
                  )}
                  <button onClick={() => removeFromQueue(q.id)} className="text-[11px] text-muted-foreground hover:text-destructive">Remove</button>
                </div>
              </li>
            ))}
          </ul>

          {log.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-[10px] tracking-wider text-muted-foreground mb-2">RECENT ALERT ACTIVITY</p>
              <ul className="text-xs space-y-1">
                {log.map((l, i) => (
                  <li key={i} className="text-muted-foreground">
                    <span className="font-mono mr-2">{new Date(l.ts).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</span>
                    {l.msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Recent Appointments</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 font-medium">Date / time</th>
                  <th className="py-2 font-medium">Patient</th>
                  <th className="py-2 font-medium">Clinician</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {appointments.slice(0, 12).map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2.5 font-mono text-xs">{a.date} {a.time}</td>
                    <td className="py-2.5">{a.patientName}</td>
                    <td className="py-2.5 text-muted-foreground">{a.clinician}</td>
                    <td className="py-2.5"><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
