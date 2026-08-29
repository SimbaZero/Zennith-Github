import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { useDoctorDashboard, useCurrentDoctor } from "@/lib/doctor-service";
import { FileText, CalendarPlus, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/doctor/")({
  component: DoctorDashboard,
});

function DoctorDashboard() {
  const { doctor } = useCurrentDoctor();
  const { data, loading, error } = useDoctorDashboard();

  const today = new Date().toISOString().slice(0, 10);
  const scheduleLabel =
    !data || data.scheduleDate === today
      ? "Today's Schedule"
      : `Schedule · ${data.scheduleDate}`;

  return (
    <AppShell
      role="doctor"
      title="Doctor Dashboard"
      showBack={false}
      staffNameOverride={doctor?.fullName}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat
          label="APPOINTMENTS"
          value={data ? String(data.stats.dayTotal) : "—"}
          sub={data ? `${data.stats.dayCompleted} completed` : "loading…"}
        />
        <Stat
          label="PATIENTS THIS WEEK"
          value={data ? String(data.stats.weekPatients) : "—"}
          sub="Unique patients, 7 days"
        />
        <Stat
          label="UPCOMING"
          value={data ? String(data.stats.upcoming) : "—"}
          sub="Future appointments"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{scheduleLabel}</h3>
            <Link
              to="/doctor/appointments"
              className="text-sm text-[oklch(0.55_0.18_245)] hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {loading && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Loading schedule…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive py-6 text-center">
                Could not load appointments.
              </p>
            )}
            {data?.schedule.map((a) => (
              <div
                key={a.docId}
                className="flex items-center gap-4 p-3 hover:bg-secondary/50 rounded-md border-l-2"
                style={{
                  borderColor:
                    a.status === "Complete" || a.status === "In-progress"
                      ? "oklch(0.6 0.15 160)"
                      : a.status === "No-show"
                        ? "oklch(0.55 0.22 25)"
                        : "oklch(0.75 0.15 70)",
                }}
              >
                <div className="font-mono text-sm font-semibold w-12">
                  {a.time}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {a.patientName}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[a.condition, a.type].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
            {data && data.schedule.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No appointments found for {data.doctorId}.
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/doctor/patients"
              className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]"
            >
              <FileText size={16} /> View Patient Files
            </Link>
            <Link
              to="/doctor/appointments"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <CalendarPlus size={16} /> New Appointment
            </Link>
            <Link
              to="/doctor/appointments"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <CalendarDays size={16} /> Full Appointments
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
              THIS WEEK
            </p>
            <Row
              label="Patients seen"
              value={data ? String(data.stats.weekPatients) : "—"}
            />
            <Row
              label="Appointments"
              value={data ? String(data.stats.weekPatients) : "—"}
            />
            <Row label="Clinician" value={data?.doctorId ?? "—"} />
          </div>
        </div>
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
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
