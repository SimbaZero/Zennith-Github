import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  usePatientFiles,
  useFindPatientById,
  useCurrentDoctor,
} from "@/lib/doctor-service";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/doctor/patients")({
  component: DoctorPatients,
});

function DoctorPatients() {
  const { doctor } = useCurrentDoctor();
  const realClinic = useRealActiveClinic(doctor?.clinicIds, "doctor");
  return (
    <AppShell
      role="doctor"
      title="Patient Files"
      staffNameOverride={doctor?.fullName}
    >
      <DoctorPatientFilesTable clinicId={realClinic.activeClinicId} />
    </AppShell>
  );
}

function DoctorPatientFilesTable({ clinicId }: { clinicId?: number }) {
  const [q, setQ] = useState("");

  const idQuery = /^pat-\d+$/i.test(q.trim())
    ? `Pat-${q.trim().match(/\d+/)![0]}`
    : null;

  // Scoped to the doctor's active clinic. Shows 20 at a time; typing 2+
  // characters searches the whole clinic roster server-side (no more
  // 500-patient ceiling). An exact Pat-### ID does a direct lookup instead.
  const {
    patients: page,
    loading: pageLoading,
    loadingMore,
    error: pageError,
    hasMore,
    loadMore,
    isSearching,
  } = usePatientFiles(idQuery ? "" : q, clinicId);
  const { patient: found, loading: findLoading } = useFindPatientById(
    idQuery,
    clinicId,
  );

  const loading = idQuery ? findLoading : pageLoading;
  // Name search now happens server-side inside usePatientFiles, so `page`
  // is already the (paged) result — no client-side filtering needed.
  const filtered = idQuery ? (found ? [found] : []) : page;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b">
        <div>
          <h3 className="font-semibold">Patient Files</h3>
          <p
            className={`text-xs mt-0.5 ${pageError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {pageError
              ? `Could not load patients: ${pageError}`
              : pageLoading
                ? "Loading patients…"
                : idQuery
                  ? "Looking up Patient ID"
                  : isSearching
                    ? `${page.length}${hasMore ? "+" : ""} match${page.length === 1 && !hasMore ? "" : "es"} — searching by name (start of first name or surname)`
                    : `Showing ${page.length}${hasMore ? "+" : ""} patients — search by name or exact Patient ID`}
          </p>
        </div>
        <input
          placeholder="Search name or Pat-###…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] w-64"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="px-5 py-3 font-medium">Patient ID</th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Condition</th>
              <th className="px-5 py-3 font-medium">Last Visit</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.patientId} className="border-t hover:bg-secondary/40">
                <td className="px-5 py-3.5 text-muted-foreground">
                  {p.patientId}
                </td>
                <td className="px-5 py-3.5 font-medium">{p.name}</td>
                <td className="px-5 py-3.5">{p.condition}</td>
                <td className="px-5 py-3.5 text-muted-foreground">
                  {p.lastVisit}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Link
                    to={`/doctor/patient-record/${p.patientId}` as any}
                    className="border px-3 py-1 rounded-md text-xs hover:bg-secondary"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-8 text-center text-muted-foreground"
                >
                  {idQuery
                    ? `No patient with ID "${idQuery}".`
                    : isSearching
                      ? "No patients found. Search matches the start of a first name or surname — or try an exact Pat-### ID."
                      : "No patients at this clinic yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!idQuery && (hasMore || loadingMore) && (
        <div className="border-t p-3 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="border px-4 py-1.5 rounded-md text-sm hover:bg-secondary disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
