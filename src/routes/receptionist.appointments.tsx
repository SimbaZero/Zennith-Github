import { createFileRoute } from "@tanstack/react-router";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { appointments } from "@/lib/data";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/receptionist/appointments")({ component: ReceptionAppointments });

function ReceptionAppointments() {
  return (
    <AppShell role="receptionist" title="Appointments">
      <div className="bg-white rounded-xl border">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold">All Appointments</h2>
          <button
            onClick={() => toast.success("New appointment slot created")}
            className="flex items-center gap-1.5 bg-[oklch(0.55_0.18_245)] text-white px-3 py-1.5 rounded-md text-sm hover:bg-[oklch(0.5_0.18_245)]"
          >
            <Plus size={14} /> New
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Date/Time</th>
                <th className="px-5 py-3 font-medium">Patient</th>
                <th className="px-5 py-3 font-medium">Doctor</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.time} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3 font-mono">{a.time}</td>
                  <td className="px-5 py-3 font-medium">{a.patient}</td>
                  <td className="px-5 py-3 text-muted-foreground">{a.doctor}</td>
                  <td className="px-5 py-3">{a.type}</td>
                  <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
