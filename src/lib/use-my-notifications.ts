import { useQuery } from "@tanstack/react-query";
import { useCurrentDoctor } from "@/lib/doctor-service";
import { useCurrentNurse } from "@/lib/nurse-service";
import { useCurrentPharmacist } from "@/lib/pharmacist-service";
import { useCurrentPatient } from "@/lib/patient-service";
import { resolveCurrentReceptionist } from "@/lib/clinic-data";
import { useCurrentAdmin, type Role } from "@/lib/auth";
import {
  useNotifications,
  useNotificationsByProfile,
  type AppNotification,
} from "@/lib/notify";

/**
 * The signed-in person's notifications, whatever their role.
 *
 * Every role's notifications live in one collection, addressed either by the
 * numeric users.userId (everyone but admins) or by profile id (admins, who have
 * no users record). The bell and the full notifications page both read through
 * this so they always agree.
 *
 * `onRelease` fires for a scheduled reminder that becomes due while this is
 * mounted; only the bell passes it, so the person gets one toast, not two.
 */
export function useMyNotifications(
  role: Role,
  onRelease?: (n: AppNotification) => void,
): AppNotification[] {
  const { patient } = useCurrentPatient();
  const { nurse } = useCurrentNurse();
  const { doctor } = useCurrentDoctor();
  const { pharmacist } = useCurrentPharmacist();
  const { data: receptionist } = useQuery({
    queryKey: ["current-receptionist"],
    queryFn: resolveCurrentReceptionist,
    enabled: role === "receptionist",
  });
  const { admin } = useCurrentAdmin();

  const userId =
    role === "patient"
      ? patient?.userId
      : role === "nurse"
        ? nurse?.userId
        : role === "doctor"
          ? doctor?.userId
          : role === "pharmacist"
            ? pharmacist?.userId
            : role === "receptionist"
              ? receptionist?.userId
              : undefined;

  // Admins and super admins have no users record, so they are addressed by
  // their profile id.
  const byProfileRole = role === "admin" || role === "super_admin";
  const byUserId = useNotifications(
    byProfileRole ? undefined : userId,
    onRelease,
  );
  const byProfile = useNotificationsByProfile(
    byProfileRole ? admin?.profileId : undefined,
  );
  return byProfileRole ? byProfile : byUserId;
}
