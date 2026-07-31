import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useDoctorWeekSchedule } from "@/lib/doctor-service";

export const Route = createFileRoute("/doctor/schedule")({ component: Schedule });

function Schedule() {
  const navigate = useNavigate();
  const { dates, apptsByDate, loading, error } = useDoctorWeekSchedule();

  const today = new Date().toISOString().slice(0, 10);
  const [picked, setPicked] = useState<string | null>(null);

  // Default to today if it falls within this week, otherwise the first day
  // of the week (e.g. viewing on a Sunday evening after the early rollover).
  const day = picked ?? (dates.includes(today) ? today : dates[0] ?? "");
  const dayAppts = apptsByDate[day] ?? [];

  return (
    <AppShell role="doctor" title="My Schedule">
      <div className="flex flex-wrap gap-2 mb-5">
        {loading && <p className="text-sm text-muted-foreground">Loading schedule…</p>}
        {dates.map((d) => (
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
          {dayAppts.length} appointment{dayAppts.length === 1 ? "" : "s"} · {day || "—"}
        </div>
        <div>
          {loading && <p className="text-sm text-muted-foreground px-5 py-6">Loading appointments…</p>}
          {error && <p className="text-sm text-destructive px-5 py-6">Could not load appointments.</p>}
          {dayAppts.map((a) => (
            <div key={a.docId} className="flex items-center gap-4 px-5 py-4 border-t first:border-t-0">
              <div className="font-mono font-semibold w-14">{a.time}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{a.patientName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {[a.patientId, a.condition, a.type].filter(Boolean).join(" · ")}
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
          {!loading && dayAppts.length === 0 && (
            <p className="text-sm text-muted-foreground px-5 py-8 text-center">No appointments on this day.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}