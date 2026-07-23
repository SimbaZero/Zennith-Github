import { createFileRoute } from "@tanstack/react-router";
import { PatientRecordView } from "@/components/PatientRecordView";

export const Route = createFileRoute("/doctor/patient-record/$pid")({
  component: () => {
    const { pid } = Route.useParams();
    return <PatientRecordView pid={pid} role="doctor" backTo="/doctor/patients" backLabel="Patient files" />;
  },
});
