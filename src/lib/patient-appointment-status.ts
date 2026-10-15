import { hasAppointmentPassed } from "@/lib/appointment-time";

// What a PATIENT is told about one of their appointments.
//
// The stored status is the clinic's working state, and it is "Scheduled" or
// "Confirmed" right up until a clinician marks the visit done. So an appointment
// that came and went with nobody closing it still said "Scheduled" (or sat
// there with a blank-looking state) on the patient's own list. Anything that is
// in the past and wasn't completed is something the patient missed, and says so.
//
// "Cancelled" is deliberately a different word and a different colour from
// "Missed": one is something the patient (or clinic) chose, the other is not.

export type PatientStatusTone =
  | "missed"
  | "cancelled"
  | "completed"
  | "progress"
  | "open";

export interface PatientStatusView {
  label: string;
  tone: PatientStatusTone;
}

export function patientStatusView(
  rawStatus: string | null | undefined,
  dateTimeIso: string,
  now = new Date(),
): PatientStatusView {
  const s = (rawStatus ?? "").trim().toLowerCase();
  if (s.includes("cancel")) return { label: "Cancelled", tone: "cancelled" };
  if (s.startsWith("complet")) return { label: "Completed", tone: "completed" };
  if (s.includes("progress")) return { label: "In progress", tone: "progress" };
  // Everything else - Scheduled, Confirmed, a staff "No-show", an old or blank
  // value - is only "still to come" if it hasn't happened yet.
  if (hasAppointmentPassed(dateTimeIso, now))
    return { label: "Missed", tone: "missed" };
  const shown = (rawStatus ?? "").trim();
  return { label: shown || "Scheduled", tone: "open" };
}
