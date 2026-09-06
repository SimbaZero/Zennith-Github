import { createFileRoute } from "@tanstack/react-router";
import { PatientRecordView } from "@/components/PatientRecordView";
import { useCurrentDoctor } from "@/lib/doctor-service";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/doctor/patient-record/")({
  component: DoctorPatientRecord,
});

// A named component, not an inline arrow: React only allows hooks inside a
// real component, and the inline version broke that rule.
function DoctorPatientRecord() {
  const { pid } = Route.useParams();
  const { doctor } = useCurrentDoctor();
  // A doctor can work at several clinics, so the header should show the one
  // they've switched to — not their first. Without this the header fell back
  // to a generic label on this page only.
  const realClinic = useRealActiveClinic(doctor?.clinicIds, "doctor");

  return (
    <PatientRecordView
      pid={pid}
      role="doctor"
      backTo="/doctor/patients"
      backLabel="Patient files"
      editable
      clinicName={realClinic.activeClinicName}
    />
  );
}
