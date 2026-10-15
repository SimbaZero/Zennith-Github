import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { OrderFlowDialog } from "@/components/OrderFlowDialog";
import {
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
  sendStockDelivery,
} from "@/lib/pharmacist-service";
import type { ClinicDeliverySuggestion } from "@/lib/stock-groups";

const fieldClass =
  "w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]";

/**
 * Medicines the selected clinic is running low on that the pharmacy can supply,
 * each with a delivery already worked out. Choosing one opens the same
 * two-step flow as ordering from a supplier: adjust, then confirm a summary.
 */
export function ClinicDeliverySuggestions({
  suggestions,
  clinicId,
  clinicName,
  pharmacistId,
  clinicNames,
}: {
  suggestions: ClinicDeliverySuggestion[];
  clinicId: number | null;
  clinicName?: string;
  pharmacistId?: string;
  clinicNames: Map<number, string>;
}) {
  if (suggestions.length === 0 || clinicId == null) return null;
  return (
    <section
      aria-label="Suggested deliveries"
      data-testid="clinic-delivery-suggestions"
      className="mb-6 rounded-xl border border-[oklch(0.85_0.08_245)] bg-white p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <Truck size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">
          Send to clinic — restock {clinicName ?? "this clinic"}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {suggestions.length} medication{suggestions.length === 1 ? "" : "s"}{" "}
          running low there
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Medicines this clinic is low on that the pharmacy's own stock can
        supply. This sends stock out to the clinic; it doesn't order anything
        from a supplier. Adjust the amount, then confirm. Stock leaves the
        sending line now; the clinic gains it when a nurse confirms it arrived.
      </p>
      <ul className="divide-y">
        {suggestions.map((s) => (
          <SuggestionRow
            key={s.forecast.docId}
            s={s}
            clinicId={clinicId}
            clinicName={clinicName}
            pharmacistId={pharmacistId}
            clinicNames={clinicNames}
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionRow({
  s,
  clinicId,
  clinicName,
  pharmacistId,
  clinicNames,
}: {
  s: ClinicDeliverySuggestion;
  clinicId: number;
  clinicName?: string;
  pharmacistId?: string;
  clinicNames: Map<number, string>;
}) {
  const f = s.forecast;
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{f.name}</p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${FORECAST_STATUS_STYLE[f.status]}`}
          >
            {FORECAST_STATUS_TEXT[f.status]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {f.onHand.toLocaleString()} on hand
          {f.daysRemaining != null
            ? ` · about ${f.daysRemaining} day${f.daysRemaining === 1 ? "" : "s"} left`
            : ""}
          {" · "}
          suggested to send {s.suggestedQty.toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-xs text-white hover:bg-[oklch(0.25_0.08_260)]"
      >
        <Truck size={13} /> Send to clinic
      </button>
      <ClinicDeliveryDialog
        open={open}
        onClose={() => setOpen(false)}
        suggestion={s}
        clinicId={clinicId}
        clinicName={clinicName}
        pharmacistId={pharmacistId}
        clinicNames={clinicNames}
      />
    </li>
  );
}

/**
 * The two-step "send this medicine to the clinic" flow: the quantity (starting
 * at the suggestion, adjustable) and the line to take it from, then a plain
 * summary to confirm. Opened from the Suggested zone on Deliveries and, the same
 * way, straight from a low stock card on the Stock page.
 */
export function ClinicDeliveryDialog({
  open,
  onClose,
  suggestion: s,
  clinicId,
  clinicName,
  pharmacistId,
  clinicNames,
}: {
  open: boolean;
  onClose: () => void;
  suggestion: ClinicDeliverySuggestion;
  clinicId: number;
  clinicName?: string;
  pharmacistId?: string;
  clinicNames: Map<number, string>;
}) {
  const f = s.forecast;
  const [qty, setQty] = useState(String(s.suggestedQty));
  const [sourceId, setSourceId] = useState(s.sources[0].docId ?? "");

  // Each time it opens it starts again from the suggestion.
  useEffect(() => {
    if (open) {
      setQty(String(s.suggestedQty));
      setSourceId(s.sources[0].docId ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const source = s.sources.find((x) => x.docId === sourceId) ?? s.sources[0];
  const n = Number(qty);
  const valid = Number.isInteger(n) && n > 0 && n <= source.units;
  const sourceLabel = (x: (typeof s.sources)[number]) =>
    `${x.clinicId != null ? (clinicNames.get(x.clinicId) ?? `Clinic ${x.clinicId}`) : "Unassigned"} line — ${x.units.toLocaleString()} in stock`;

  return (
    <OrderFlowDialog
      open={open}
      onClose={onClose}
      title={`Send ${f.name} to ${clinicName ?? "the clinic"}`}
      description={`${clinicName ?? "The clinic"} is running low. This sends the pharmacy's own stock out to it. Adjust the amount if you need to; you'll see a summary before anything is sent.`}
      canContinue={valid && !!pharmacistId}
      continueLabel="Review delivery"
      summaryTitle="Send this to the clinic?"
      summary={[
        { label: "Medication", value: f.name },
        {
          label: "Quantity",
          value: `${valid ? n.toLocaleString() : "—"} units`,
        },
        { label: "To", value: clinicName ?? `Clinic ${clinicId}` },
        { label: "Taken from", value: sourceLabel(source) },
      ]}
      reassurance="The units leave the sending line now and travel as a delivery on the way. The clinic's stock goes up only when a nurse there confirms it arrived."
      confirmLabel="Send to clinic"
      onConfirm={async () => {
        if (!pharmacistId) throw new Error("Pharmacist not identified.");
        const res = await sendStockDelivery({
          clinicId,
          pharmacistId,
          items: [
            {
              inventoryDocId: source.docId!,
              name: f.name,
              quantity: n,
            },
          ],
          note: "Suggested delivery — stock was running low at the clinic",
        });
        if (!res.ok)
          throw new Error(res.error ?? "Could not send the delivery");
        toast.success(
          `Delivery of ${n} × ${f.name} sent to ${clinicName ?? "the clinic"} — awaiting confirmation`,
        );
      }}
      details={
        <>
          <div>
            <label
              htmlFor={`dq-${f.docId}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Quantity to deliver
            </label>
            <input
              id={`dq-${f.docId}`}
              type="number"
              min={1}
              max={source.units}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`${fieldClass} ${valid ? "" : "border-red-400 bg-red-50"}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {n > source.units
                ? `Only ${source.units.toLocaleString()} available on that line.`
                : `Suggested: ${s.suggestedQty.toLocaleString()} (what the clinic needs, up to what that line can spare).`}
            </p>
          </div>
          <div>
            <label
              htmlFor={`ds-${f.docId}`}
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Take it from
            </label>
            <select
              id={`ds-${f.docId}`}
              value={source.docId}
              onChange={(e) => setSourceId(e.target.value)}
              className={fieldClass}
            >
              {s.sources.map((x) => (
                <option key={x.docId} value={x.docId}>
                  {sourceLabel(x)}
                </option>
              ))}
            </select>
          </div>
        </>
      }
    />
  );
}
