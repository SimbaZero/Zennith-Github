import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { fetchRecentAppointments } from "@/lib/clinic-data";
import { UserCircle2, CalendarPlus, MessageCircle } from "lucide-react";
import { useState } from "react";
import { enqueueNotification, nextAllowed } from "@/lib/notifications-queue";
import { toast } from "sonner";
import { useNow } from "@/lib/store";

export const Route = createFileRoute("/receptionist/")({
  component: ReceptionDashboard,
});

function ReceptionDashboard() {
  const navigate = useNavigate();
  const now = useNow(60_000);
  const { data: appointments = [] } = useQuery({
    queryKey: ["recent-appointments-dash"],
    queryFn: fetchRecentAppointments,
  });
  const [queue, setQueue] = useState(appointments.slice(0, 6));
  const [log, setLog] = useState<Array<{ ts: string; msg: string }>>([]);

  const notifyNext = () => {
    if (queue.length === 0) return toast.info("No patients in queue");
    const next = queue[0];
    const now = new Date();
    const scheduled = nextAllowed(now);
    const willSendNow = scheduled.getTime() <= now.getTime();
    enqueueNotification({
      title: `Next patient: ${next.patientName}`,
      body: `Hi ${next.patientName} — you're next for ${next.clinician}. Please prepare to enter the clinical room.`,
    });
    const msg = willSendNow
      ? `SMS sent to ${next.patientName}.`
      : `Queued for ${next.patientName} — outside 07:00–20:00 window; will send at ${scheduled.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}.`;
    setLog((l) => [{ ts: new Date().toISOString(), msg }, ...l].slice(0, 8));
    setQueue((q) => [...q.slice(1), q[0]]);
    toast.success(msg);
  };

  const remove = (i: number) => setQueue((q) => q.filter((_, k) => k !== i));

  return (
    <AppShell role="receptionist" title="Reception Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="TODAY'S APPOINTMENTS"
          value={String(appointments.length)}
          sub="Scheduled"
        />
        <Stat
          label="ACUTE QUEUE"
          value={String(queue.length)}
          sub="Walk-ins waiting"
        />
        <Stat
          label="LAST UPDATED"
          value={now.toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          sub="Auto-refresh"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Acute Walk-in Queue</h3>
            <button
              onClick={notifyNext}
              className="flex items-center gap-1.5 bg-[oklch(0.18_0.06_260)] text-white text-xs px-3 py-1.5 rounded-md hover:bg-[oklch(0.25_0.08_260)]"
            >
              <MessageCircle size={12} /> Notify next via SMS
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Send window: 07:00 – 20:00. Late messages are queued.
          </p>
          <ul className="space-y-1.5">
            {queue.length === 0 ? (
              <li className="text-sm text-muted-foreground py-4 text-center">
                Queue is empty
              </li>
            ) : (
              queue.map((a, i) => (
                <li
                  key={i}
                  className={`flex items-center gap-3 p-2 rounded-md ${i === 0 ? "bg-[oklch(0.97_0.03_245)] border border-[oklch(0.85_0.08_245)]" : "hover:bg-secondary/40"}`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? "bg-[oklch(0.55_0.18_245)] text-white" : "bg-secondary"}`}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {a.patientName}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.clinician} · {a.type}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(i)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>

          {log.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-[10px] tracking-wider text-muted-foreground mb-2">
                RECENT SMS ACTIVITY
              </p>
              <ul className="text-xs space-y-1">
                {log.map((l, i) => (
                  <li key={i} className="text-muted-foreground">
                    <span className="font-mono mr-2">
                      {new Date(l.ts).toLocaleTimeString("en-ZA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {l.msg}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Scheduled Appointments (today)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Patient</th>
                  <th className="py-2 font-medium">Doctor</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2.5 font-mono">{a.time}</td>
                    <td className="py-2.5">{a.patientName}</td>
                    <td className="py-2.5 text-muted-foreground">
                      {a.clinician}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
        <button
          onClick={() => navigate({ to: "/receptionist/registration" })}
          className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]"
        >
          + New Registration
        </button>
        <Link
          to="/receptionist/profiles"
          className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary bg-white"
        >
          <UserCircle2 size={16} /> Patient Profiles
        </Link>
        <Link
          to="/receptionist/appointments"
          className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary bg-white"
        >
          <CalendarPlus size={16} /> Book Appointment
        </Link>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
