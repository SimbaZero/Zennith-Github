import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import { fetchPatientPage } from "@/lib/clinic-data";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/receptionist/profiles")({
  component: Profiles,
});

function Profiles() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const {
    data: all = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["patient-page"],
    queryFn: fetchPatientPage,
  });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.patientId.toLowerCase().includes(t),
    );
  }, [q, all]);

  return (
    <AppShell role="receptionist" title="Patient Profiles">
      <div className="bg-white rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b">
          <h3 className="font-semibold">All Patient Profiles</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or ID…"
            className="px-3 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-5 py-3 font-medium">Patient ID</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Condition</th>
                <th className="px-5 py-3 font-medium">Last Visit</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-destructive"
                  >
                    Failed to load patients.
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    No matching patients.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.patientId}
                  className="border-b last:border-0 hover:bg-secondary/40"
                >
                  <td className="px-5 py-3 text-muted-foreground font-mono text-xs">
                    {p.patientId}
                  </td>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 text-xs">{p.condition}</td>
                  <td className="px-5 py-3 font-mono text-xs">{p.lastVisit}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() =>
                        navigate({ to: "/receptionist/registration" })
                      }
                      className="border text-xs px-3 py-1 rounded-md hover:bg-secondary"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 text-xs text-muted-foreground border-t">
          Showing first {all.length} patients — search by ID for others not
          listed here.
        </div>
      </div>
    </AppShell>
  );
}
