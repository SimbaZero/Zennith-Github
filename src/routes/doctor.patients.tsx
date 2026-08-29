import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  usePatientDirectory,
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

  // Previously unscoped — a doctor could browse and search every patient
  // in every clinic. Same fix already applied to Nurse and Receptionist.
  const { patients: page, loading: pageLoading } = usePatientDirectory(
    500,
    clinicId,
  );

  const idQuery = /^pat-\d+$/i.test(q.trim())
    ? `Pat-${q.trim().match(/\d+/)![0]}`
    : null;
  const { patient: found, loading: findLoading } = useFindPatientById(
    idQuery,
    clinicId,
  );

  const loading = idQuery ? findLoading : pageLoading;
  const filtered = idQuery
    ? found
      ? [found]
      : []
    : page.filter(
        (p) =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.patientId.toLowerCase().includes(q.toLowerCase()),
      );

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b">
        <div>
          <h3 className="font-semibold">Patient Files</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pageLoading
              ? "Loading patients…"
              : `${page.length} patients at this clinic — search by name or exact Patient ID`}
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
                    : "No matching patients in the loaded page — try an exact Pat-### ID."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
