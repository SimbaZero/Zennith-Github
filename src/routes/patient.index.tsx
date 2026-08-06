import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { useNow } from "@/lib/store";
import { useActiveClinic } from "@/lib/clinic";
import { useInventory } from "@/lib/pharmacist-service"; // real central stock, shared across roles
import {
  useCurrentPatient,
  usePatientAppointments,
  usePatientNotifications,
} from "@/lib/patient-service";
import {
  FileText,
  Calendar,
  Bell,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/patient/")({
  component: PatientDashboard,
});

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AppointmentStatusBadge({ status }: { status: string }) {
  const color =
    status === "Cancelled"
      ? "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]"
      : status === "Completed"
        ? "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]"
        : "bg-[oklch(0.96_0.05_245)] text-[oklch(0.4_0.15_245)]"; // Scheduled / default
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full ${color}`}>
      {status}
    </span>
  );
}

function PatientDashboard() {
  const navigate = useNavigate();
  const now = useNow(1000);
  const clinic = useActiveClinic();
  const { stock } = useInventory();

  const { patient, loading: patientLoading } = useCurrentPatient();
  const appointments = usePatientAppointments(patient?.patientId);
  const notifications = usePatientNotifications(patient?.userId);
  const unread = notifications.filter((n) => !n.isRead).length;

  const upcoming = appointments
    .filter((a) => a.status !== "Cancelled" && new Date(a.dateTime) >= now)
    .slice(0, 3);
  const nextAppointment = upcoming[0];

  const dateStr = now.toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const timeStr = now.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    return stock
      .filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          (s.category ?? "").toLowerCase().includes(term),
      )
      .slice(0, 6);
  }, [q, stock]);

  return (
    <AppShell role="patient" title="My Dashboard" showBack={false}>
      <div className="bg-[oklch(0.18_0.06_260)] text-white rounded-xl p-6 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-white/60">Welcome back,</p>
          <h2 className="text-3xl font-bold mt-1">
            {patientLoading
              ? "Loading..."
              : (patient?.fullName ?? "Unknown patient")}
          </h2>
          <p className="text-sm text-white/70 mt-1">
            {patient?.patientId} · {clinic.name}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">{dateStr}</p>
          <p className="text-2xl font-mono font-semibold">{timeStr}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Search size={16} className="text-[oklch(0.55_0.18_245)]" />
          <h3 className="font-semibold">Find a medication</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Search current stock across the pharmacy.
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Search by medication name, e.g. "Metformin", "TLD"...'
          className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
        />
        {q.trim().length >= 2 && (
          <ul className="mt-3 divide-y border rounded-md">
            {results.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                No match found.
              </li>
            )}
            {results.map((s) => {
              const inStock = s.units > 0;
              return (
                <li
                  key={s.name}
                  className="p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.category}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${inStock ? "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]" : "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]"}`}
                  >
                    {inStock ? (
                      <CheckCircle2 size={12} />
                    ) : (
                      <AlertCircle size={12} />
                    )}
                    {inStock ? "In stock" : "Out of stock"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-[11px] tracking-wider text-muted-foreground">
            NEXT APPOINTMENT
          </p>
          <p className="text-2xl font-bold mt-1">
            {nextAppointment
              ? formatDateTime(nextAppointment.dateTime)
              : "None scheduled"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {nextAppointment?.clinician ?? ""}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-[11px] tracking-wider text-muted-foreground">
            MEDICATION STATUS
          </p>
          <p className="text-2xl font-bold mt-1 text-[oklch(0.5_0.18_160)]">
            Available
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ready for collection at {clinic.name}
          </p>
        </div>
        <button
          onClick={() => navigate({ to: "/patient/alerts" })}
          className="text-left bg-white rounded-xl border p-5 hover:bg-secondary/30"
        >
          <p className="text-[11px] tracking-wider text-muted-foreground">
            UNREAD ALERTS
          </p>
          <p className="text-2xl font-bold mt-1">{unread}</p>
          <p className="text-xs text-[oklch(0.55_0.18_245)] mt-1">View all →</p>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">My Appointments</h3>
          {upcoming.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No upcoming appointments.
            </p>
          )}
          {upcoming.map((a) => (
            <div
              key={a.docId}
              className="flex items-center justify-between py-3 border-b last:border-0"
            >
              <div>
                <div className="font-mono font-semibold">
                  {formatDateTime(a.dateTime)}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.clinician}
                </div>
              </div>
              <AppointmentStatusBadge status={a.status} />
            </div>
          ))}
          <Link
            to="/patient/appointments"
            search={{ confirm: undefined }}
            className="block text-center text-sm text-[oklch(0.55_0.18_245)] mt-3 hover:underline"
          >
            View all appointments →
          </Link>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/patient/medical-record"
              className="flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)]"
            >
              <FileText size={16} /> View Medical Record
            </Link>
            <Link
              to="/patient/appointments"
              search={{ confirm: undefined }}
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Calendar size={16} /> My Appointments
            </Link>
            <Link
              to="/patient/alerts"
              className="flex items-center justify-center gap-2 border py-2.5 rounded-md text-sm hover:bg-secondary"
            >
              <Bell size={16} /> Notifications
            </Link>
          </div>
          <div className="mt-5 pt-5 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              Medication Collection
            </p>
            <div className="bg-[oklch(0.96_0.05_160)] text-[oklch(0.35_0.12_160)] rounded-md p-3 text-sm">
              ✓ Available at {clinic.name}
              <br />
              <span className="text-xs">Collection hours: 08:00 — 16:00</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
