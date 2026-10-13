import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ClinicRequestsView } from "@/components/ClinicRequestsView";
import { useCurrentAdmin } from "@/lib/auth";

export const Route = createFileRoute("/admin/requests")({
  component: Requests,
});

function Requests() {
  const { admin } = useCurrentAdmin();
  return (
    <AppShell
      role="admin"
      title="Clinic Requests"
      clinicNameOverride={admin?.clinicName}
    >
      <ClinicRequestsView />
    </AppShell>
  );
}
