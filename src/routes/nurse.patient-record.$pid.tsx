import { createFileRoute } from "@tanstack/react-router";
import { PatientRecordView } from "@/components/PatientRecordView";

export const Route = createFileRoute("/nurse/patient-record/$pid")({
  component: () => {
    const { pid } = Route.useParams();
    return <PatientRecordView pid={pid} role="nurse" backTo="/nurse/patients" backLabel="Patient files" />;
  },
});
