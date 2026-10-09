import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { useNow } from "@/lib/store";
import { useInventory } from "@/lib/pharmacist-service";
import { sameClinicId } from "@/lib/clinic-id";
import {
  appointmentDateTimeLabel,
  isUpcomingAppointment,
} from "@/lib/appointment-time";
import {
  useCurrentPatient,
  usePatientAppointments,
  useMedicationStatus,
  usePatientNotifications,
} from "@/lib/patient-service";
import { MedicationReminders } from "@/components/MedicationReminders";
import { PatientCalledCard } from "@/components/PatientCalledCard";
import {
  FileText,
  Calendar,
  Bell,
  Pill,
  Search,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/patient/")({
  component: PatientDashboard,
});

// The stored appointment time is the clinic's wall-clock time, not UTC — read it
// as such (see appointment-time.ts) rather than converting it to the device's.
const formatDateTime = appointmentDateTimeLabel;

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
  const { stock, loading: stockLoading, usingFallback } = useInventory();

  const { patient, loading: patientLoading } = useCurrentPatient();
  const { status: medStatus } = useMedicationStatus(
    patient?.patientId,
    patient?.prescription,
  );
  const clinicLabel = patient?.clinicName ?? "No clinic assigned";
  const appointments = usePatientAppointments(patient?.patientId);
  const notifications = usePatientNotifications(patient?.userId);
  const unread = notifications.filter((n) => !n.isRead).length;

  const upcoming = appointments
    .filter(
      (a) => a.status !== "Cancelled" && isUpcomingAppointment(a.dateTime, now),
    )
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
  // Only this patient's own clinic. useInventory reads every clinic's stock, so
  // without this a patient was told a drug was "In stock" when the only units
  // were somewhere they couldn't collect it. Compared number/string-tolerantly:
  // StockItem.clinicId is typed number but is whatever Firestore holds.
  const clinicStock = useMemo(
    () => stock.filter((s) => sameClinicId(s.clinicId, patient?.clinicId)),
    [stock, patient?.clinicId],
  );
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    // When useInventory has fallen back to demo data the rows are invented and
    // belong to no clinic — never present them as availability.
    if (usingFallback || term.length < 2) return [];
    return clinicStock
      .filter(
        (s) =>
          s.name.toLowerCase().includes(term) ||
          (s.category ?? "").toLowerCase().includes(term),
      )
      .slice(0, 6);
  }, [q, clinicStock, usingFallback]);

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
            {patient?.patientId} · {clinicLabel}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">{dateStr}</p>
          <p className="text-2xl font-mono font-semibold">{timeStr}</p>
        </div>
      </div>

      {/* Nothing on this page matters more than "go in now", so it sits
          directly under the greeting. Renders nothing unless this patient has
          actually been called. */}
      <PatientCalledCard patientId={patient?.patientId} />

      <div className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Search size={16} className="text-[oklch(0.55_0.18_245)]" />
          <h3 className="font-semibold">Find a medication</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Search what is in stock at {patient?.clinicName ?? "your clinic"}.
        </p>
        {usingFallback && (
          <div
            role="status"
            className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            Live stock is unavailable right now, so search is paused rather than
            showing demo numbers. Please check with your clinic before
            travelling.
          </div>
        )}
        {!usingFallback && !patientLoading && patient?.clinicId == null && (
          <p className="mb-3 text-sm text-muted-foreground">
            You're not linked to a clinic yet, so there's no stock to search.
          </p>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={usingFallback || patient?.clinicId == null}
          placeholder='Search by medication name, e.g. "Metformin", "TLD"...'
          className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] disabled:bg-secondary/50 disabled:cursor-not-allowed"
        />
        {!usingFallback && q.trim().length >= 2 && (
          <ul className="mt-3 divide-y border rounded-md">
            {(stockLoading || patientLoading) && (
              <li className="p-3 text-sm text-muted-foreground">
                Loading stock…
              </li>
            )}
            {!stockLoading && !patientLoading && results.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                No match found at {patient?.clinicName ?? "your clinic"}.
              </li>
            )}
            {results.map((s) => {
              const inStock = s.units > 0;
              return (
                <li
                  key={s.docId ?? s.name}
                  className="p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
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

      {patient?.prescription?.trim() && patient.patientId && (
        <div
          id="medication-reminders"
          className="scroll-mt-24 bg-white rounded-xl border p-5 mb-6 transition-shadow duration-300"
        >
          <div className="flex items-center gap-2 mb-1">
            <Pill size={16} className="text-[oklch(0.55_0.18_245)]" />
            <h3 className="font-semibold">Medication Reminders</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            For {patient.prescription}
          </p>
          <MedicationReminders
            patientId={patient.patientId}
            userId={patient.userId}
            med={patient.prescription}
            savedTimes={patient.reminderTimes ?? []}
          />
        </div>
      )}

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
          <p
            className={`text-2xl font-bold mt-1 ${
              medStatus.state === "none"
                ? "text-muted-foreground"
                : "text-[oklch(0.5_0.18_160)]"
            }`}
          >
            {medStatus.label}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {medStatus.detail}
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
            <div className="bg-secondary/50 rounded-md p-3 text-sm">
              {medStatus.state === "none" ? (
                <span className="text-muted-foreground">
                  No medication currently prescribed.
                </span>
              ) : (
                <>
                  <strong>{medStatus.medication}</strong>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    {medStatus.detail} Collect at {clinicLabel}.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
