import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPatientPage,
  findPatient,
  resolveCurrentReceptionist,
} from "@/lib/clinic-data";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/receptionist/profiles")({
  component: Profiles,
});

function Profiles() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  // Which clinic this receptionist belongs to — the patient list below is
  // now scoped to it instead of pulling the first 30 patients system-wide
  // (previous bug, see #17 in docs/db-issues.md).
  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
  });

  const {
    data: all = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["patient-page", receptionist?.clinicId],
    queryFn: () => fetchPatientPage(receptionist?.clinicId),
    enabled: receptionist !== undefined,
  });

  // The old search box only ever filtered the already-loaded page, so a
  // patient outside the first 30 (or now, outside this clinic) looked like
  // it didn't exist even when a receptionist typed their exact Patient ID.
  // This does a direct Firestore lookup by ID as a fallback whenever the
  // typed text looks like one and isn't already in the loaded list.
  const [idLookup, setIdLookup] = useState<{
    patientId: string;
    name: string;
    condition: string;
    lastVisit: string;
  } | null>(null);
  const [idLookupTried, setIdLookupTried] = useState("");

  useEffect(() => {
    const t = q.trim();
    const looksLikeId = /^pat-?\d+$/i.test(t);
    if (!looksLikeId || t.toLowerCase() === idLookupTried.toLowerCase()) return;
    const alreadyLoaded = all.some(
      (p) => p.patientId.toLowerCase() === t.toLowerCase(),
    );
    if (alreadyLoaded) return;
    const normalized = /^pat-/i.test(t) ? t : `Pat-${t.replace(/^pat/i, "")}`;
    setIdLookupTried(t);
    findPatient(normalized, receptionist?.clinicId).then((p) => setIdLookup(p));
  }, [q, all, idLookupTried]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    const local = all.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.patientId.toLowerCase().includes(t),
    );
    if (
      local.length === 0 &&
      idLookup &&
      idLookup.patientId.toLowerCase().includes(t)
    ) {
      return [idLookup];
    }
    return local;
  }, [q, all, idLookup]);

  return (
    <AppShell
      role="receptionist"
      title="Patient Profiles"
      clinicNameOverride={receptionist?.clinicName}
      staffNameOverride={receptionist?.name}
    >
      <div className="bg-white rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b">
          <div>
            <h3 className="font-semibold">All Patient Profiles</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {receptionist?.clinicName ?? "Loading clinic…"}
            </p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or ID (e.g. Pat-42)…"
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
                        navigate({
                          to: `/receptionist/profiles/${p.patientId}`,
                        })
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
          Showing {all.length} patient{all.length === 1 ? "" : "s"} at this
          clinic — search by exact Patient ID to look up anyone not listed.
        </div>
      </div>
    </AppShell>
  );
}
