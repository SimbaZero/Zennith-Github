import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientAppointments,
  updateAppointmentStatus,
  requestAppointmentReminder,
  type PatientAppointmentRow,
} from "@/lib/patient-service";
import { isOffline } from "@/lib/offline";
import { Check, X, Bell, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/appointments")({
  component: PatientAppointments,
  validateSearch: (s: Record<string, unknown>) => ({
    confirm: typeof s.confirm === "string" ? s.confirm : undefined,
  }),
});

function AppointmentStatusBadge({ status }: { status: string }) {
  const color =
    status === "Cancelled"
      ? "bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]"
      : status === "Confirmed" || status === "Completed"
        ? "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]"
        : "bg-[oklch(0.96_0.05_245)] text-[oklch(0.4_0.15_245)]"; // Scheduled / default
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

function formatDate(dt: Date) {
  return dt.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function formatTime(dt: Date) {
  return dt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

// Soft lock: anything already in the past, Completed, or Cancelled can no
// longer be touched by the patient. Only upcoming, still-open appointments
// are actionable (matches Doc-1/Nur-1 style real-name resolution already
// done upstream in usePatientAppointments).
function isLocked(a: PatientAppointmentRow, now: Date): boolean {
  return (
    new Date(a.dateTime) < now ||
    a.status === "Cancelled" ||
    a.status === "Completed"
  );
}

function PatientAppointments() {
  const { confirm } = useSearch({ from: "/patient/appointments" });
  const { patient } = useCurrentPatient();
  const appointments = usePatientAppointments(patient?.patientId);

  // If opened via an SMS-style confirm link (?confirm=<docId>), write the
  // real confirmation to Firestore once. The ref guards against re-firing
  // on every re-render.
  const confirmedRef = useRef<string | null>(null);
  const [pastLimit, setPastLimit] = useState(5);
  useEffect(() => {
    if (confirm && confirmedRef.current !== confirm) {
      confirmedRef.current = confirm;
      updateAppointmentStatus(confirm, "Confirmed")
        .then(() =>
          toast.success(
            isOffline()
              ? "Confirmation saved on this device — it will reach the clinic when you're back online"
              : "Appointment confirmed via SMS link",
          ),
        )
        .catch((err) => {
          console.error(err);
          toast.error("Couldn't confirm appointment. Please try again.");
        });
    }
  }, [confirm]);

  const now = new Date();

  // Current/upcoming first (soonest first), past ones below (most recent
  // past first).
  const upcoming = appointments
    .filter((a) => !isLocked(a, now))
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  const past = appointments
    .filter((a) => isLocked(a, now))
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));

  // Clicking the ALREADY-ACTIVE button undoes it back to "Scheduled" instead
  // of doing nothing — so patients aren't locked into a choice. Clicking the
  // other (inactive) button switches straight to that status as before.
  const toggleStatus = async (
    docId: string,
    currentStatus: string,
    target: "Confirmed" | "Cancelled",
  ) => {
    const nextStatus = currentStatus === target ? "Scheduled" : target;
    try {
      await updateAppointmentStatus(
        docId,
        nextStatus as "Confirmed" | "Cancelled",
      );
      // Offline these are queued, so the clinic hasn't seen them yet — a
      // patient told "clinic will be notified" would reasonably stop there
      // and not follow up.
      toast.success(
        isOffline()
          ? "Saved on this device — it will reach the clinic when you're back online"
          : nextStatus === "Scheduled"
            ? "Reverted to scheduled"
            : nextStatus === "Confirmed"
              ? "Appointment confirmed"
              : "Appointment cancelled — clinic will be notified",
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to update appointment. Please try again.");
    }
  };

  const sendReminder = async (a: PatientAppointmentRow) => {
    if (patient?.userId == null) {
      toast.error("Can't send a reminder — no linked account found.");
      return;
    }
    try {
      await requestAppointmentReminder(a, patient.userId);
      toast.success("Reminder sent to your notifications");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't send reminder. Please try again.");
    }
  };

  return (
    <AppShell role="patient" title="My Appointments">
      <div className="bg-white rounded-xl border overflow-hidden mb-6">
        <div className="p-5 border-b flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold">Upcoming</h3>
          <span className="text-xs text-muted-foreground">
            SMS reminders sent one day prior include a Confirm link.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Clinician</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No upcoming appointments.
                  </td>
                </tr>
              )}
              {upcoming.map((a, i) => {
                const dt = new Date(a.dateTime);
                const isNext = i === 0;
                const pending = a.status !== "Confirmed";
                return (
                  <tr
                    key={a.docId}
                    className={`border-t ${isNext ? "bg-[oklch(0.97_0.05_245)]" : ""}`}
                  >
                    <td className="px-5 py-3.5 font-medium">
                      <div>{formatDate(dt)}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {formatTime(dt)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {a.clinician}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <AppointmentStatusBadge status={a.status} />
                        {isNext && pending && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[oklch(0.94_0.1_75)] text-[oklch(0.4_0.15_75)]">
                            Next · pending confirmation
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          disabled={a.status === "Cancelled"}
                          onClick={() =>
                            toggleStatus(a.docId, a.status, "Confirmed")
                          }
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Confirmed"
                              ? "bg-[oklch(0.94_0.08_160)] border-[oklch(0.7_0.1_160)]"
                              : "hover:bg-[oklch(0.97_0.06_160)]"
                          }`}
                          title={
                            a.status === "Confirmed"
                              ? "Click to undo confirmation"
                              : "Confirm this appointment"
                          }
                        >
                          <Check size={12} />{" "}
                          {a.status === "Confirmed" ? "Confirmed" : "Confirm"}
                        </button>
                        <button
                          disabled={a.status === "Confirmed"}
                          onClick={() =>
                            toggleStatus(a.docId, a.status, "Cancelled")
                          }
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Cancelled"
                              ? "bg-[oklch(0.94_0.08_25)] border-[oklch(0.7_0.15_25)]"
                              : "hover:bg-[oklch(0.97_0.05_25)]"
                          }`}
                          title={
                            a.status === "Cancelled"
                              ? "Click to undo cancellation"
                              : "Cancel this appointment"
                          }
                        >
                          <X size={12} />{" "}
                          {a.status === "Cancelled" ? "Cancelled" : "Cancel"}
                        </button>
                        {pending && (
                          <button
                            onClick={() => sendReminder(a)}
                            className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-[oklch(0.97_0.05_245)]"
                            title="Send yourself a reminder notification now"
                          >
                            <Bell size={12} /> Remind me
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b">
          <h3 className="font-semibold">Past Appointments</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Locked — completed, cancelled, or already-passed appointments can't
            be changed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Clinician</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {past.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No past appointments.
                  </td>
                </tr>
              )}
              {/* A chronic patient can accumulate hundreds of past visits,
                  so this shows the most recent few rather than everything. */}
              {past.slice(0, pastLimit).map((a) => {
                const dt = new Date(a.dateTime);
                return (
                  <tr key={a.docId} className="border-t text-muted-foreground">
                    <td className="px-5 py-3.5 font-medium">
                      <div>{formatDate(dt)}</div>
                      <div className="text-xs font-mono">{formatTime(dt)}</div>
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {a.clinician}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <AppointmentStatusBadge status={a.status} />
                        <Lock size={12} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {past.length > 5 && (
            <div className="flex gap-2 p-4 border-t">
              {past.length > pastLimit && (
                <button
                  onClick={() => setPastLimit((n) => n + 10)}
                  className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                >
                  Show more ({past.length - pastLimit} older)
                </button>
              )}
              {pastLimit > 5 && (
                <button
                  onClick={() => setPastLimit(5)}
                  className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                >
                  Collapse
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
