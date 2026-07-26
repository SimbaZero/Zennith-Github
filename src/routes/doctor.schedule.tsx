import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { fetchDoctorAppointments, attachPatientNames } from "@/lib/clinic-data";
import { useState } from "react";

export const Route = createFileRoute("/doctor/schedule")({ component: Schedule });

function Schedule() {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: fetchDoctorAppointments,
  });

  const day = picked ?? data?.scheduleDate ?? "";
  const dayAppts = (data?.appts ?? []).filter((a) => a.date === day);

  const { data: rows = [], isLoading: namesLoading } = useQuery({
    queryKey: ["doctor-day", day, dayAppts.length],
    queryFn: () => attachPatientNames(dayAppts),
    enabled: !!data && dayAppts.length > 0,
  });

  // Show a window of up to 7 dates around the selected day.
  const dates = data?.dates ?? [];
  const idx = Math.max(0, dates.indexOf(day));
  const window = dates.slice(Math.max(0, idx - 2), Math.max(0, idx - 2) + 7);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell role="doctor" title="My Schedule">
      <div className="flex flex-wrap gap-2 mb-5">
        {isLoading && <p className="text-sm text-muted-foreground">Loading scheduleâ€¦</p>}
        {window.map((d) => (
          <button
            key={d}
            onClick={() => setPicked(d)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              d === day ? "bg-[oklch(0.18_0.06_260)] text-white" : "bg-white border hover:bg-secondary"
            }`}
          >
            {d === today ? "Today" : d}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b text-sm font-medium">
          {dayAppts.length} appointment{dayAppts.length === 1 ? "" : "s"} Â· {day || "â€”"}
        </div>
        <div>
          {namesLoading && dayAppts.length > 0 && (
            <p className="text-sm text-muted-foreground px-5 py-6">Loading appointmentsâ€¦</p>
          )}
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-4 px-5 py-4 border-t first:border-t-0">
              <div className="font-mono font-semibold w-14">{a.time}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{a.patientName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {[a.patientId, a.condition, a.type].filter(Boolean).join(" Â· ")}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">30min</span>
              <button
                onClick={() => navigate({ to: "/doctor/appointments", search: { date: day } })}
                className="border px-3 py-1 rounded-md text-xs hover:bg-secondary"
              >
                View
              </button>
            </div>
          ))}
          {data && dayAppts.length === 0 && (
            <p className="text-sm text-muted-foreground px-5 py-8 text-center">No appointments on this day.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
