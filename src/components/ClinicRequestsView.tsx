import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import { Loading, Spinner } from "@/components/Loading";
import { useCurrentAdmin } from "@/lib/auth";
import { OPEN_SECTION_EVENT } from "@/lib/jump-to-section";
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
 * The "Clinic requests" part of the All Staff page: requests to add a doctor or
 * pharmacist to a clinic, waiting for an admin. Closed by default behind a small
 * toggle, so it isn't prominent until there is something to look at (the count
 * in the toggle says so).
 *
 * It opens by itself when the page is reached from a clinic-request
 * notification (`openRequested`, from the page's `?requests=1`), and when a
 * notification link jumps to it while the page is already open.
 */
export function ClinicRequestsSection({
  openRequested = false,
}: {
  openRequested?: boolean;
}) {
  const { requests, loading, error } = useClinicAssignmentRequests();
  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const [open, setOpen] = useState(openRequested);
  const ref = useRef<HTMLElement>(null);

  // Arriving from a notification.
  useEffect(() => {
    if (openRequested) setOpen(true);
  }, [openRequested]);

  // A notification link that jumps here while the page is already showing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const expand = () => setOpen(true);
    el.addEventListener(OPEN_SECTION_EVENT, expand);
    return () => el.removeEventListener(OPEN_SECTION_EVENT, expand);
  }, []);

  return (
    <section
      id="clinic-requests"
      ref={ref}
      aria-label="Clinic requests"
      className="mb-4 rounded-lg"
      data-testid="clinic-requests-section"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="clinic-requests-body"
        className="flex min-h-[36px] w-full items-center gap-2 px-1 text-left text-sm text-muted-foreground hover:text-foreground"
      >
        <ClipboardList size={14} aria-hidden />
        <span className="font-medium">Clinic requests</span>
        {pendingCount > 0 && (
          <span
            className="text-xs font-medium text-amber-800"
            data-testid="clinic-requests-count"
          >
            {pendingCount} waiting
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden
          className={`ml-auto transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id="clinic-requests-body" className="mt-2">
          <ClinicRequestsView
            requests={requests}
            loading={loading}
            error={error}
          />
        </div>
      )}
    </section>
  );
}

/**
 * The requests themselves. Each one says who it is for, where they work now,
 * who asked and when - so the decision is made with the context in front of the
 * approver.
 */
function ClinicRequestsView({
  requests,
  loading,
  error,
}: {
  requests: ClinicAssignmentRequest[];
  loading: boolean;
  error: boolean;
}) {
  const { admin } = useCurrentAdmin();
  const by = admin?.fullName || admin?.username || "admin";
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");
  const [showDecided, setShowDecided] = useState(false);

  return (
    <div
      className="space-y-5 rounded-xl border bg-white p-4"
      data-testid="clinic-requests"
    >
      <p className="text-sm text-muted-foreground">
        Adding a doctor or pharmacist to another clinic waits here for an admin
        to approve it. Nothing changes for them until you do.
      </p>

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
