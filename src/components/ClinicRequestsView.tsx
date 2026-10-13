import { useState } from "react";
import { Check, ChevronDown, ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import { Loading, Spinner } from "@/components/Loading";
import { useCurrentAdmin } from "@/lib/auth";
import {
  approveClinicRequest,
  denyClinicRequest,
  requestSentence,
  staffTitle,
  useClinicAssignmentRequests,
  type ClinicAssignmentRequest,
} from "@/lib/clinic-assignment";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "date not recorded"
    : d.toLocaleString("en-ZA", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/**
 * Requests to add a doctor or pharmacist to a clinic, waiting for an admin.
 * Each one says who it is for, where they work now, who asked and when - so the
 * decision is made with the context in front of the approver.
 */
export function ClinicRequestsView() {
  const { requests, loading, error } = useClinicAssignmentRequests();
  const { admin } = useCurrentAdmin();
  const by = admin?.fullName || admin?.username || "admin";
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const [showDecided, setShowDecided] = useState(false);

  return (
    <div className="max-w-3xl space-y-6" data-testid="clinic-requests">
      <div>
        <h2 className="text-lg font-semibold">Clinic assignment requests</h2>
        <p className="text-sm text-muted-foreground">
          Adding a doctor or pharmacist to another clinic waits here for an
          admin to approve it. Nothing changes for them until you do.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Loading label="Loading requests" />
        </p>
      ) : error ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Couldn't load the requests. If this is new, the database permissions
          for clinic requests may not be switched on yet.
        </p>
      ) : (
        <>
          <section aria-label="Waiting for a decision">
            <h3 className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground">
              WAITING FOR A DECISION ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing is waiting for approval.
              </p>
            ) : (
              <ul className="space-y-3">
                {pending.map((r) => (
                  <PendingCard key={r.id} r={r} by={by} />
                ))}
              </ul>
            )}
          </section>

          {decided.length > 0 && (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => setShowDecided((v) => !v)}
                aria-expanded={showDecided}
                className="w-full min-h-[40px] flex items-center gap-2 text-left"
              >
                <ClipboardList size={14} className="text-muted-foreground" />
                <span className="text-sm font-medium">
                  {showDecided
                    ? "Hide decided requests"
                    : "View decided requests"}{" "}
                  ({decided.length})
                </span>
                <ChevronDown
                  size={14}
                  className={`text-muted-foreground transition ${showDecided ? "rotate-180" : ""}`}
                />
              </button>
              {showDecided && (
                <ul className="mt-2 divide-y rounded-lg border bg-white">
                  {decided.slice(0, 20).map((r) => (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <p>
                        <strong>
                          {r.status === "approved" ? "Approved" : "Denied"}:
                        </strong>{" "}
                        {staffTitle(r.role, r.staffName)} → {r.clinicName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        by {r.resolvedBy ?? "an admin"} ·{" "}
                        {when(r.resolvedAt ?? r.requestedAt)}
                        {r.denyReason ? ` · "${r.denyReason}"` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PendingCard({ r, by }: { r: ClinicAssignmentRequest; by: string }) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (kind: "approve" | "deny") => {
    setBusy(kind);
    try {
      if (kind === "approve") {
        await approveClinicRequest(r.id, by);
        toast.success(
          `${staffTitle(r.role, r.staffName)} now works at ${r.clinicName}.`,
        );
      } else {
        await denyClinicRequest(r.id, by, reason);
        toast.success("Request denied. Nothing was changed for them.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the decision.",
      );
    } finally {
      setBusy(null);
    }
  };

  const worksAt = r.currentClinicNames.length
    ? r.currentClinicNames
        .map((n, i) => (i === 0 ? `${n} (home)` : n))
        .join(", ")
    : "no clinic recorded";

  return (
    <li
      className="rounded-xl border bg-white p-4"
      data-testid="pending-clinic-request"
    >
      <p className="text-sm font-medium">{requestSentence(r)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Works at now</dt>
        <dd>{worksAt}</dd>
        <dt className="text-muted-foreground">Would also work at</dt>
        <dd className="font-medium">{r.clinicName}</dd>
        <dt className="text-muted-foreground">Requested by</dt>
        <dd>
          {r.requestedBy || "an admin"} · {when(r.requestedAt)}
        </dd>
      </dl>

      {denying && (
        <input
          aria-label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="Reason (optional) — shown in the decision history"
          className="mt-3 w-full rounded-md border px-3 py-2 text-sm"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run("approve")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {busy === "approve" ? <Spinner /> : <Check size={13} />} Approve
        </button>
        {denying ? (
          <>
            <button
              type="button"
              onClick={() => run("deny")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {busy === "deny" ? <Spinner /> : <X size={13} />} Confirm deny
            </button>
            <button
              type="button"
              onClick={() => setDenying(false)}
              disabled={busy !== null}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              Back
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setDenying(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            <X size={13} /> Deny
          </button>
        )}
      </div>
    </li>
  );
}
