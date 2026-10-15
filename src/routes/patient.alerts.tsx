import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { NotificationsView } from "@/components/NotificationsView";
import { useCurrentPatient } from "@/lib/patient-service";
import { PatientCalledCard } from "@/components/PatientCalledCard";
import { useOnline } from "@/lib/offline";
import { Wifi, WifiOff } from "lucide-react";

export const Route = createFileRoute("/patient/alerts")({
  validateSearch: (s: Record<string, unknown>): { n?: string } =>
    typeof s.n === "string" && s.n ? { n: s.n } : {},
  component: Alerts,
});

function Alerts() {
  const { patient } = useCurrentPatient();
  const { n } = Route.useSearch();
  const navigate = useNavigate();
  const online = useOnline();

  return (
    <AppShell role="patient" title="Notifications & Alerts">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${online ? "bg-[oklch(0.97_0.06_160)] text-[oklch(0.4_0.15_160)]" : "bg-[oklch(0.97_0.05_60)] text-[oklch(0.45_0.17_60)]"}`}
        >
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          {online ? "Online" : "Offline — changes will sync"}
        </span>
      </div>

      {/* The "You're being called" notification lands in the list below, so
          the thing to do about it belongs on this page too. */}
      <PatientCalledCard patientId={patient?.patientId} />

      <NotificationsView
        role="patient"
        selectedId={n}
        onSelect={(docId) =>
          navigate({
            to: "/patient/alerts",
            search: docId ? { n: docId } : {},
          })
        }
      />
    </AppShell>
  );
}
