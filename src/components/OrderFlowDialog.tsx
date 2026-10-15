import { useEffect, useState, type ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";
import { Spinner } from "@/components/Loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface OrderSummaryRow {
  label: string;
  value: string;
}

/**
 * A two-step "are you sure" for something that sets stock moving: first choose
 * the details, then read a plain summary of exactly what is about to happen and
 * confirm it. Nothing is placed by the first step. Deliberately calm - no red,
 * no warning icon - because placing an order is a normal thing to do.
 *
 * Used for ordering from a supplier and for sending a delivery to a clinic, so
 * the two feel the same.
 */
export function OrderFlowDialog({
  open,
  onClose,
  title,
  description,
  details,
  canContinue,
  continueLabel = "Review order",
  summaryTitle = "Please check this before it's placed",
  summary,
  reassurance,
  confirmLabel = "Place order",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Step 1: the adjustable fields. */
  details: ReactNode;
  /** Whether step 1 is complete enough to go on to the review. */
  canContinue: boolean;
  continueLabel?: string;
  summaryTitle?: string;
  /** Step 2: what is about to be placed, row by row. */
  summary: OrderSummaryRow[];
  /** One sentence under the summary saying what this does and doesn't do. */
  reassurance?: string;
  confirmLabel?: string;
  /** Does the work. Throw to show the message and stay on the review step. */
  onConfirm: () => Promise<void>;
}) {
  const [stage, setStage] = useState<"details" | "review">("details");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  // Every time it opens it starts at the first step.
  useEffect(() => {
    if (open) {
      setStage("details");
      setBusy(false);
      setProblem("");
    }
  }, [open]);

  const place = async () => {
    setBusy(true);
    setProblem("");
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error && error.message
          ? error.message
          : "That didn't go through. Nothing was changed — please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        data-testid="order-flow-dialog"
        data-stage={stage}
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {stage === "details" ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="space-y-4">{details}</div>
            <DialogFooter className="gap-2 sm:gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStage("review")}
                disabled={!canContinue}
                className="rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {continueLabel}
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-2 text-[oklch(0.4_0.15_245)]">
                <ClipboardCheck size={20} aria-hidden />
                <span className="text-sm font-medium">One last look</span>
              </div>
              <DialogTitle>{summaryTitle}</DialogTitle>
            </DialogHeader>
            <dl
              className="divide-y rounded-lg border bg-[oklch(0.98_0.01_245)] text-sm"
              data-testid="order-summary"
            >
              {summary.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 px-4 py-2.5"
                >
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="text-right font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
            {reassurance && (
              <p className="text-sm text-muted-foreground">{reassurance}</p>
            )}
            {problem && (
              <p
                role="alert"
                data-testid="order-problem"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                {problem}
              </p>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <button
                type="button"
                onClick={() => setStage("details")}
                disabled={busy}
                className="rounded-md border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                onClick={place}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy && <Spinner />}
                {busy ? "Placing…" : confirmLabel}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
