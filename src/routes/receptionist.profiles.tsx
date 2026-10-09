import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPatientPage,
  findPatient,
  searchPatientsByName,
  resolveCurrentReceptionist,
  type PatientSummary,
} from "@/lib/clinic-data";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/receptionist/profiles")({
  component: Profiles,
});

/**
 * Is this search text a name worth asking the database about — as opposed to a
 * Patient ID (handled by the lookup below) or a bare number? The ID test is the
 * exact one the ID lookup uses, not "starts with pat", so Patricia and Patrick
 * still count as names.
 */
function isNameTerm(t: string): boolean {
  return (
    t.length >= 2 &&
    !/^pat-?\d+$/i.test(t) &&
    !/^\d+$/.test(t) &&
    /\p{L}/u.test(t)
  );
}

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
  const [idLookup, setIdLookup] = useState<PatientSummary | null>(null);
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

  // Name search beyond the loaded page. The loaded list is capped, and a name
  // isn't on the patient's own document, so the database is asked through a
  // lowercase word list stored on it (see searchPatientsByName). Debounced, so
  // it's one query per pause in typing rather than one per keystroke.
  const nameTerm = useMemo(() => {
    const t = q.trim();
    return isNameTerm(t) ? t : "";
  }, [q]);
  const receptionistReady = receptionist !== undefined;
  const receptionistClinicId = receptionist?.clinicId;
  // The term each result set belongs to is kept with it, so results for "ler"
  // are never shown as if they were for "lera" while the next search is pending.
  const [nameResults, setNameResults] = useState<{
    term: string;
    rows: PatientSummary[];
  }>({ term: "", rows: [] });
  const [nameSearching, setNameSearching] = useState(false);
  const [nameSearchFailed, setNameSearchFailed] = useState(false);

  useEffect(() => {
    if (!nameTerm || !receptionistReady) {
      setNameSearching(false);
      setNameSearchFailed(false);
      return;
    }
    let cancelled = false;
    setNameSearching(true);
    setNameSearchFailed(false);
    const timer = setTimeout(() => {
      searchPatientsByName(nameTerm, receptionistClinicId)
        .then((rows) => {
          if (!cancelled) setNameResults({ term: nameTerm, rows });
        })
        .catch((err) => {
          // Most likely the composite index (clinicId + nameTokensLower) hasn't
          // been created yet. Say so rather than show "no matches".
          console.error("Patient name search failed:", err);
          if (!cancelled) setNameSearchFailed(true);
        })
        .finally(() => {
          if (!cancelled) setNameSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [nameTerm, receptionistReady, receptionistClinicId]);

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
    // Loaded matches first, then anything the database found that isn't
    // already among them — de-duplicated by patientId.
    if (nameTerm && nameResults.term === nameTerm) {
      const seen = new Set(local.map((p) => p.patientId));
      return [
        ...local,
        ...nameResults.rows.filter((p) => !seen.has(p.patientId)),
      ];
    }
    return local;
  }, [q, all, idLookup, nameTerm, nameResults]);

  return (
    <AppShell
      role="receptionist"
      title="Patient Profiles"
      clinicNameOverride={receptionist?.clinicName}
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
                {/* No "Condition" column, deliberately. Reception has no
                    clinical role, so under POPIA they don't see diagnoses —
                    and PatientSummary no longer carries one. Don't add it
                    back; see the note above PatientSummary in clinic-data.ts. */}
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-5 py-6 text-center text-destructive"
                  >
                    Failed to load patients.
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-5 py-6 text-center text-muted-foreground"
                  >
                    {nameTerm && nameSearching
                      ? "Searching this clinic…"
                      : nameTerm && nameSearchFailed
                        ? "Couldn't search beyond the loaded patients — try the exact Patient ID."
                        : "No matching patients."}
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
        {nameTerm && nameSearching && filtered.length > 0 && (
          <div className="px-5 py-2 text-xs text-muted-foreground border-t">
            Searching the rest of the clinic…
          </div>
        )}
        {nameTerm && nameSearchFailed && filtered.length > 0 && (
          <div className="px-5 py-2 text-xs text-amber-700 border-t">
            Couldn't search beyond the loaded patients — try the exact Patient
            ID.
          </div>
        )}
        <div className="px-5 py-3 text-xs text-muted-foreground border-t">
          Showing {all.length} patient{all.length === 1 ? "" : "s"} at this
          clinic — search by name or Patient ID to find anyone not listed.
        </div>
      </div>
    </AppShell>
  );
}
