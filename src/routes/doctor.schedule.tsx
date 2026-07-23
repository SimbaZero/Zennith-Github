import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { scheduleDays } from "@/lib/data";
import { useAppointments, useNow, computeEffective } from "@/lib/store";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/doctor/schedule")({ component: Schedule });

function Schedule() {
  const navigate = useNavigate();
  const [day, setDay] = useState(0);
  const rows = useAppointments();
  const now = useNow(30_000);
  const effective = useMemo(() => computeEffective(rows, now), [rows, now]);

  // For day 0 show everything; future days show a subset (demo data).
  const list = useMemo(() => {
    if (day === 0) return effective;
    const step = Math.max(4, effective.length - day * 6);
    return effective.slice(0, step);
  }, [day, effective]);

  const view = (time: string, patient: string) => {
    const hash = `appt-${encodeURIComponent(time)}-${encodeURIComponent(patient)}`;
    (navigate as any)({ to: "/doctor/appointments", hash });
    setTimeout(() => {
      const el = document.getElementById(hash);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("ring-2", "ring-[oklch(0.55_0.18_245)]");
      setTimeout(() => el?.classList.remove("ring-2", "ring-[oklch(0.55_0.18_245)]"), 2000);
    }, 150);
  };

  return (
    <AppShell role="doctor" title="My Schedule">
      <div className="flex flex-wrap gap-2 mb-5">
        {scheduleDays.map((d, i) => (
          <button
            key={d.iso}
            onClick={() => setDay(i)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              i === day ? "bg-[oklch(0.18_0.06_260)] text-white" : "bg-white border hover:bg-secondary"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b text-sm font-medium">{list.length} appointments</div>
        <div>
          {list.map((a) => (
            <div key={`${a.time}-${a.patient}`} className="flex items-center gap-4 px-5 py-4 border-t first:border-t-0">
              <div className="font-mono font-semibold w-14">{a.time}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{a.patient}</div>
                <div className="text-xs text-muted-foreground truncate">{a.pid} · {a.doctor} · {a.note}</div>
              </div>
              <span className="text-xs text-muted-foreground">30min</span>
              <button
                onClick={() => view(a.time, a.patient)}
                className="border px-3 py-1 rounded-md text-xs hover:bg-secondary"
              >
                View
              </button>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
