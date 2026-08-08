import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientAppointments,
  updateAppointmentStatus,
} from "@/lib/patient-service";
import { Check, X } from "lucide-react";
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

function PatientAppointments() {
  const { confirm } = useSearch({ from: "/patient/appointments" });
  const { patient } = useCurrentPatient();
  const appointments = usePatientAppointments(patient?.patientId);

  // If opened via an SMS-style confirm link (?confirm=<docId>), write the
  // real confirmation to Firestore once. The ref guards against re-firing
  // on every re-render.
  const confirmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (confirm && confirmedRef.current !== confirm) {
      confirmedRef.current = confirm;
      updateAppointmentStatus(confirm, "Confirmed")
        .then(() => toast.success("Appointment confirmed via SMS link"))
        .catch((err) => {
          console.error(err);
          toast.error("Couldn't confirm appointment. Please try again.");
        });
    }
  }, [confirm]);

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
      await updateAppointmentStatus(docId, nextStatus as "Confirmed" | "Cancelled" | "Scheduled");
      toast.success(
        nextStatus === "Scheduled"
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

  return (
    <AppShell role="patient" title="My Appointments">
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-semibold">My Appointments</h3>
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
              {appointments.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No appointments found.
                  </td>
                </tr>
              )}
              {appointments.map((a) => {
                const dt = new Date(a.dateTime);
                return (
                  <tr key={a.docId} className="border-t">
                    <td className="px-5 py-3.5 font-medium">
                      <div>
                        {dt.toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {dt.toLocaleTimeString("en-ZA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {a.clinician}
                    </td>
                    <td className="px-5 py-3.5">
                      <AppointmentStatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2">
                        <button
                          disabled={a.status === "Cancelled"}
                          onClick={() => toggleStatus(a.docId, a.status, "Confirmed")}
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Confirmed"
                              ? "bg-[oklch(0.94_0.08_160)] border-[oklch(0.7_0.1_160)]"
                              : "hover:bg-[oklch(0.97_0.06_160)]"
                          }`}
                          title={a.status === "Confirmed" ? "Click to undo confirmation" : "Confirm this appointment"}
                        >
                          <Check size={12} /> {a.status === "Confirmed" ? "Confirmed" : "Confirm"}
                        </button>
                        <button
                          disabled={a.status === "Confirmed"}
                          onClick={() => toggleStatus(a.docId, a.status, "Cancelled")}
                          className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md disabled:opacity-40 ${
                            a.status === "Cancelled"
                              ? "bg-[oklch(0.94_0.08_25)] border-[oklch(0.7_0.15_25)]"
                              : "hover:bg-[oklch(0.97_0.05_25)]"
                          }`}
                          title={a.status === "Cancelled" ? "Click to undo cancellation" : "Cancel this appointment"}
                        >
                          <X size={12} /> {a.status === "Cancelled" ? "Cancelled" : "Cancel"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
