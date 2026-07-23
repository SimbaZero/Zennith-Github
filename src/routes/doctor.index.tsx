import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { appointments } from "@/lib/data";
import { FileText, CalendarPlus, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/doctor/")({ component: DoctorDashboard });

function DoctorDashboard() {
  return (
    <AppShell role="doctor" title="Doctor Dashboard" showBack={false}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="TODAY APPOINTMENTS" value="4" sub="3 confirmed" />
        <Stat label="PENDING REVIEWS" value="3" sub="Lab results" />
        <Stat label="PATIENTS THIS WEEK" value="18" sub="vs 16 last week" />
        <Stat label="FOLLOW-UPS DUE" value="7" sub="Next 7 days" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Today's Schedule</h3>
            <Link to="/doctor/schedule" className="text-sm text-[oklch(0.55_0.18_245)] hover:underline">View all →</Link>
          </div>
          <div className="space-y-2">
            {appointments.slice(0, 4).map((a) => (
              <div key={a.time} className="flex items-center gap-4 p-3 hover:bg-secondary/50 rounded-md border-l-2" style={{ borderColor: a.status === "Complete" || a.status === "In-progress" ? "oklch(0.6 0.15 160)" : a.status === "No-show" ? "oklch(0.55 0.22 25)" : "oklch(0.75 0.15 70)" }}>
                <div className="font-mono text-sm font-semibold w-12">{a.time}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{a.patient}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.note} · {a.type}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link to="/doctor/patients" className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]">
              <FileText size={16} /> View Patient Files
            </Link>
            <Link to="/doctor/appointments" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary">
              <CalendarPlus size={16} /> New Appointment
            </Link>
            <Link to="/doctor/schedule" className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary">
              <CalendarDays size={16} /> My Full Schedule
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-[11px] tracking-wider text-muted-foreground mb-2">THIS WEEK</p>
            <Row label="Patients seen" value="18" />
            <Row label="Avg consultation" value="22m" />
            <Row label="Follow-ups scheduled" value="9" />
          </div>
        </div>
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
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
