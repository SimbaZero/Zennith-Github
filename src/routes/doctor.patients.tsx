import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PatientFilesTable } from "./nurse.patients";

export const Route = createFileRoute("/doctor/patients")({ component: () => (
  <AppShell role="doctor" title="Patient Files"><PatientFilesTable recordBase="/doctor/patient-record" /></AppShell>
)});
