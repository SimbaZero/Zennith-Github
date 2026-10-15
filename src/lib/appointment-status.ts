import type { AppointmentStatus } from "@/components/AppShell";

// How an appointment's stored `status` text is labelled to staff.
//
// This used to be written out twice (clinic-data.ts and doctor-service.ts) and
// the copies drifted: the doctor and nurse pages use doctor-service's, which
// treated everything it didn't recognise as "Incomplete" - so a patient's
// CONFIRMED appointment showed to the doctor as "Incomplete", and a patient's
// CANCELLED one as "No-show". The data was arriving live; it was the label that
// was wrong. One function now, used by both.
export function toBadgeStatus(s: string | null | undefined): AppointmentStatus {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("complet")) return "Complete";
  if (v.includes("progress")) return "In-progress";
  // A patient cancelling is not a no-show: the clinic knew in advance.
  if (v.includes("cancel")) return "Cancelled";
  if (v.includes("no-show") || v.includes("no show")) return "No-show";
  if (v.includes("confirm")) return "Confirmed";
  if (v.includes("schedul")) return "Scheduled";
  // Anything else (an old or hand-entered value) is shown as not yet done, as before.
  return "Incomplete";
}

/** The coloured left edge of an appointment row on the dashboards. */
export function statusEdgeColour(status: AppointmentStatus): string {
  switch (status) {
    case "Complete":
    case "In-progress":
      return "oklch(0.6 0.15 160)";
    case "Confirmed":
      return "oklch(0.62 0.13 215)";
    case "No-show":
      return "oklch(0.55 0.22 25)";
    case "Cancelled":
      return "oklch(0.75 0.02 260)";
    default:
      return "oklch(0.75 0.15 70)";
  }
}
