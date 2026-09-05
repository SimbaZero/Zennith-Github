import { createFileRoute } from "@tanstack/react-router";
import { PatientRecordView } from "@/components/PatientRecordView";
import { useCurrentNurse } from "@/lib/nurse-service";

export const Route = createFileRoute("/nurse/patient-record/$pid")({
  component: () => {
    const { pid } = Route.useParams();
    const { nurse } = useCurrentNurse();
    return (
      <PatientRecordView
        pid={pid}
        role="nurse"
        backTo="/nurse/patients"
        backLabel="Patient files"
        editable
        clinicId={nurse?.clinicId}
        clinicName={nurse?.clinicName}
        nurseId={nurse?.nurseId}
      />
    );
  },
});
