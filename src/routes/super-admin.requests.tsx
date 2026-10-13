import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ClinicRequestsView } from "@/components/ClinicRequestsView";

export const Route = createFileRoute("/super-admin/requests")({
  component: Requests,
});

function Requests() {
  return (
    <AppShell role="super_admin" title="Clinic Requests">
      <ClinicRequestsView />
    </AppShell>
  );
}
