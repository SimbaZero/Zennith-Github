import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loading } from "@/components/Loading";
import { useCurrentAdmin } from "@/lib/auth";
import {
  fetchRealClinics,
  getStaffClinicIds,
  setStaffClinics,
  type ClinicStaffMember,
  type MultiClinicRole,
} from "@/lib/clinic-data";
import {
  pendingFor,
  requestClinicAssignments,
  staffTitle,
  useClinicAssignmentRequests,
} from "@/lib/clinic-assignment";

/**
 * Which clinics a doctor or pharmacist works at, from the admin's staff page.
 * Taking a clinic away applies straight away; adding one only sends a request
 * for an admin to approve (see clinic-assignment.ts).
 */
export function StaffClinicsPanel({
  staff,
  onClose,
  onDone,
}: {
  staff: ClinicStaffMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const role = staff.role as MultiClinicRole;
  const { admin } = useCurrentAdmin();
  const { data: clinics = [], isLoading: clinicsLoading } = useQuery({
    queryKey: ["all-clinics"],
    queryFn: fetchRealClinics,
  });
  const { data: current, isLoading: currentLoading } = useQuery({
    queryKey: ["staff-clinics", role, staff.staffId],
    queryFn: () => getStaffClinicIds(role, staff.staffId),
  });
  const { requests } = useClinicAssignmentRequests();
  const awaiting = pendingFor(requests, staff.staffId).map((r) => r.clinicId);

  const [picked, setPicked] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = current ?? [];
  const chosen = picked ?? mine;
  const home = mine[0];

  const toggle = (id: number) =>
    setPicked(
      chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id],
    );

  // Taking a clinic away applies at once; adding one is only a request.
  const removed = mine.filter((c) => !chosen.includes(c));
  const added = chosen.filter((c) => !mine.includes(c));
  const changed = removed.length > 0 || added.length > 0;
  const title = staffTitle(role, staff.fullName);

  const save = async () => {
    if (mine.length - removed.length === 0) {
      toast.error(
        "Keep at least one of their current clinics for now. A clinic you're adding only takes effect once it's approved.",
      );
      return;
    }
    setBusy(true);
    try {
      if (removed.length > 0) {
        await setStaffClinics({
          role,
          staffId: staff.staffId,
          clinicIds: mine.filter((c) => !removed.includes(c)),
        });
      }
      if (added.length > 0) {
        const r = await requestClinicAssignments({
          role,
          staffId: staff.staffId,
          staffName: staff.fullName,
          clinicIds: added,
          requestedBy: admin?.fullName || admin?.username || "admin",
        });
        toast.success(
          r.created > 0
            ? `Request sent: ${r.created} clinic${r.created === 1 ? "" : "s"} for ${title} waiting for an admin to approve.`
            : "Those requests were already waiting for approval.",
        );
      } else {
        toast.success(`${title}'s clinics were updated.`);
      }
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save their clinics.",
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = clinicsLoading || currentLoading;

  return (
    <div
      className="mb-4 bg-white rounded-xl border border-[oklch(0.55_0.18_245)] p-5"
      data-testid="staff-clinics-panel"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">
            Clinics for {title}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {staff.staffId}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adding a clinic sends a request that an admin approves; it takes
            effect only then. Taking one away applies straight away. They switch
            between their clinics from the clinic name in the page header.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs border px-3 py-1.5 rounded-md hover:bg-secondary shrink-0"
        >
          Cancel
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Loading label="Loading clinics" />
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-4">
          {clinics.map((c) => {
            const waiting = awaiting.includes(c.clinicId);
            const isChosen = waiting || chosen.includes(c.clinicId);
            return (
              <li key={c.clinicId}>
                <label
                  className={`flex items-center gap-2 text-sm border rounded-md px-3 py-2 ${
                    waiting
                      ? "bg-secondary/40"
                      : "hover:bg-secondary/40 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChosen}
                    onChange={() => toggle(c.clinicId)}
                    disabled={busy || waiting}
                  />
                  <span className="flex-1">{c.clinicName}</span>
                  {c.clinicId === home && (
                    <span className="text-[10px] text-muted-foreground">
                      home
                    </span>
                  )}
                  {waiting && (
                    <span className="text-[10px] font-medium text-amber-800">
                      awaiting approval
                    </span>
                  )}
                  {!waiting && added.includes(c.clinicId) && (
                    <span className="text-[10px] text-muted-foreground">
                      will be requested
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy || loading || !changed}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-60"
        >
          {busy
            ? "Saving…"
            : added.length > 0
              ? `Request approval for ${added.length} clinic${added.length === 1 ? "" : "s"}`
              : "Save clinics"}
        </button>
      </div>
    </div>
  );
}
