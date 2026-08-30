import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import {
  UserCircle2,
  CalendarPlus,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNow } from "@/lib/store";
import type {
  QueueEntry,
  TriageLevel,
  ClinicWideAppointment,
} from "@/lib/clinic-data";
import { resolveCurrentReceptionist } from "@/lib/clinic-data";

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

const TRIAGE_SHORT: Record<TriageLevel, string> = {
  red: "CRITICAL",
  orange: "EMERGENT",
  yellow: "URGENT",
  green: "ROUTINE",
};

let clinicData: typeof import("@/lib/clinic-data") | null = null;
async function getClinicData() {
  if (!clinicData) clinicData = await import("@/lib/clinic-data");
  return clinicData;
}

function ReceptionDashboard() {
  const navigate = useNavigate();
  const now = useNow(60_000);

  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
  });
  const realFacilityId =
    receptionist?.clinicId != null ? String(receptionist.clinicId) : null;

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [clinicReady, setClinicReady] = useState(false);

  useEffect(() => {
    getClinicData().then(() => setClinicReady(true));
  }, []);

  // Read-only live view — the dashboard shows the shape of the queue, the
  // dedicated /receptionist/queue page is where you actually work it.
  useEffect(() => {
    if (!clinicReady) return;
    let unsubscribe: (() => void) | undefined;
    getClinicData().then(({ subscribeQueue }) => {
      unsubscribe = subscribeQueue(
        (rows) => setQueue(rows),
        () => {},
        realFacilityId,
      );
    });
    return () => unsubscribe?.();
  }, [clinicReady, realFacilityId]);

  const { data: appointments = [] } = useQuery({
    queryKey: ["recent-appointments", realFacilityId],
    queryFn: async () => {
      const { fetchRecentAppointments } = await getClinicData();
      return fetchRecentAppointments(receptionist?.clinicId);
    },
    enabled: clinicReady,
  });

  const active = queue.filter((q) => q.status !== "done");
  const waiting = active.filter(
    (q) => q.status === "waiting" || q.status === "called",
  );
  const inProgress = active.filter(
    (q) => q.status === "in-room" || q.status === "handoff",
  );
  const criticalWaiting = waiting.filter((q) => q.triage === "red");
  const nextUp = waiting.slice(0, 4);

  const getWaitTime = (joinedAt: string) =>
    Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 60000);

  return (
    <AppShell
      role="receptionist"
      title="Reception Dashboard"
      showBack={false}
      clinicNameOverride={receptionist?.clinicName}
      staffNameOverride={receptionist?.name}
    >
      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Stat
          label="WAITING"
          value={String(waiting.length)}
          sub="Acute queue"
        />
        <Stat
          label="IN PROGRESS"
          value={String(inProgress.length)}
          sub="With clinician"
        />
        <Stat
          label="RED TRIAGE"
          value={String(criticalWaiting.length)}
          sub="Critical"
          alert={criticalWaiting.length > 0}
        />
        <Stat
          label="LAST UPDATED"
          value={now.toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          sub="Live"
        />
      </div>

      {criticalWaiting.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-600 shrink-0" />
          <p className="text-sm text-red-700">
            <strong>{criticalWaiting.length} critical patient(s)</strong>{" "}
            waiting immediate attention
          </p>
          <Link
            to="/receptionist/queue"
            className="ml-auto text-xs font-medium bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 shrink-0"
          >
            Open queue
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Queue summary — a glance, not a workspace */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Next in queue</h3>
              <p className="text-xs text-muted-foreground">
                {waiting.length === 0
                  ? "Nobody waiting"
                  : `${waiting.length} waiting`}
              </p>
            </div>
            <Link
              to="/receptionist/queue"
              className="flex items-center gap-1 text-xs font-medium border px-3 py-1.5 rounded-md hover:bg-secondary"
            >
              Manage queue <ArrowRight size={12} />
            </Link>
          </div>

          {nextUp.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Queue is empty
            </p>
          ) : (
            <ul className="space-y-2">
              {nextUp.map((q, i) => (
                <li
                  key={q.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border"
                >
                  <span className="w-6 text-center text-lg font-bold shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {q.patientName}
                      </p>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${TRIAGE_COLORS[q.triage]}`}
                      >
                        {TRIAGE_SHORT[q.triage]}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Waiting {getWaitTime(q.joinedAt)} min
                      {q.clinician ? ` · ${q.clinician}` : ""}
                    </p>
                  </div>
                </li>
              ))}
              {waiting.length > nextUp.length && (
                <li className="text-xs text-muted-foreground text-center pt-1">
                  + {waiting.length - nextUp.length} more waiting
                </li>
              )}
            </ul>
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
                {appointments.slice(0, 8).map((a: ClinicWideAppointment) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">
                      {a.date} {a.time}
                    </td>
                    <td className="py-2">{a.patientName}</td>
                    <td className="py-2">
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quick actions */}
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
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-5 ${alert ? "border-red-300 bg-red-50" : ""}`}
    >
      <p className="text-[11px] tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-3xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
