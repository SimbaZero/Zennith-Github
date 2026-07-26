import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { currentPatient, patientAppointments } from "@/lib/data";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/appointments")({
  component: PatientAppointments,
  // `confirm` must be genuinely optional — returning it as a required key whose
  // type includes undefined makes `search` mandatory on every Link to this route.
  validateSearch: (s: Record<string, unknown>): { confirm?: string } =>
    typeof s.confirm === "string" ? { confirm: s.confirm } : {},
});

type LocalStatus = "Confirmed" | "Cancelled" | null;
const KEY = "zennith_patient_appt_status";

function loadStatuses(): Record<string, LocalStatus> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function saveStatuses(s: Record<string, LocalStatus>) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s));
}

function PatientAppointments() {
  const { confirm } = useSearch({ from: "/patient/appointments" });
  const [statuses, setStatuses] = useState<Record<string, LocalStatus>>({});

  useEffect(() => { setStatuses(loadStatuses()); }, []);
  useEffect(() => {
    if (confirm) {
      const next = { ...loadStatuses(), [confirm]: "Confirmed" as const };
      saveStatuses(next);
      setStatuses(next);
      toast.success("Appointment confirmed via SMS link");
    }
  }, [confirm]);

  const set = (key: string, v: LocalStatus) => {
    const next = { ...statuses, [key]: v };
    setStatuses(next); saveStatuses(next);
    toast.success(v === "Confirmed" ? "Appointment confirmed" : "Appointment cancelled — clinic will be notified");
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
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {patientAppointments.map((a) => {
                const key = `${a.date}_${a.time}`;
                const local = statuses[key];
                return (
                  <tr key={key} className="border-t">
                    <td className="px-5 py-3.5 font-medium">
                      <div>{a.date}</div>
                      <div className="text-xs text-muted-foreground font-mono">{a.time} · {a.doctor}</div>
                    </td>
                    <td className="px-5 py-3.5">{currentPatient.name}</td>
                    <td className="px-5 py-3.5">{a.type}</td>
                    <td className="px-5 py-3.5">
                      {local === "Confirmed" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]">Confirmed</span>
                      ) : local === "Cancelled" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[oklch(0.94_0.08_25)] text-[oklch(0.4_0.2_25)]">Cancelled</span>
                      ) : (
                        <StatusBadge status={a.status} />
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2">
                        <button
                          disabled={local === "Confirmed"}
                          onClick={() => set(key, "Confirmed")}
                          className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-[oklch(0.97_0.06_160)] disabled:opacity-40"
                        >
                          <Check size={12} /> Confirm
                        </button>
                        <button
                          disabled={local === "Cancelled"}
                          onClick={() => set(key, "Cancelled")}
                          className="flex items-center gap-1 text-xs border px-2.5 py-1 rounded-md hover:bg-[oklch(0.97_0.05_25)] disabled:opacity-40"
                        >
                          <X size={12} /> Cancel
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
