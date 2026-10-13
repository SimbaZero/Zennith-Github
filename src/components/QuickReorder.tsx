import { useState } from "react";
import { PackagePlus, BellRing } from "lucide-react";
import { SupplierOrderDialog } from "@/components/SupplierOrderDialog";
import {
  FORECAST_STATUS_STYLE,
  FORECAST_STATUS_TEXT,
  reorderSuggestions,
  useOpenReorders,
  type MedForecast,
} from "@/lib/pharmacist-service";

// Suggested reorders, and the "Automated reorder" that acts on them.
//
// A medication at "Order now" or "Reorder soon" used to be visible only as a
// coloured row in the stock view - the pharmacist had to notice it. These bring
// the suggestion to them, with a quantity already worked out from real usage
// that they can change, and a supplier to choose, before confirming twice.

/**
 * The "Order from supplier" button for one medication. It opens a two-step
 * flow (quantity and supplier, then a summary to confirm), and placing the order
 * lists it as a delivery on the way. It does not add stock, and it does not send
 * anything to a clinic.
 */
export function QuickReorderForm({
  forecast,
  clinicId,
  clinicName,
  className = "",
}: {
  forecast: MedForecast;
  clinicId: number | undefined;
  clinicName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!forecast.docId || clinicId == null) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-[11px] text-muted-foreground">
        Suggested order: {forecast.suggestedOrder.toLocaleString()}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-xs text-white hover:bg-[oklch(0.25_0.08_260)]"
      >
        <PackagePlus size={13} /> Order from supplier
      </button>
      <SupplierOrderDialog
        open={open}
        onClose={() => setOpen(false)}
        medName={forecast.name}
        clinicId={clinicId}
        clinicName={clinicName}
        inventoryDocId={forecast.docId}
        currentUnits={forecast.onHand}
        suggestedQty={forecast.suggestedOrder}
      />
    </div>
  );
}

/**
 * Every medication that is low enough to need ordering and has no order in
 * hand, shown without anyone having to go looking. Hidden when there are none:
 * an empty panel every day would teach people to ignore the space.
 */
export function SuggestedReorders({
  forecasts,
  clinicId,
  clinicName,
}: {
  forecasts: MedForecast[];
  clinicId: number | undefined;
  clinicName?: string;
}) {
  const { openByInventoryDoc, loading } = useOpenReorders(clinicId);
  // Don't flash suggestions that are about to be hidden by an order already placed.
  if (loading) return null;
  const items = reorderSuggestions(forecasts, openByInventoryDoc);
  if (items.length === 0) return null;
  const critical = items.filter((f) => f.status === "critical").length;

  return (
    <section
      aria-label="Suggested reorders"
      className={`mb-6 rounded-xl border bg-white p-5 ${
        critical > 0 ? "border-red-300" : "border-amber-300"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <BellRing
          size={16}
          className={critical > 0 ? "text-red-600" : "text-amber-600"}
        />
        <h3 className="font-semibold">Order from supplier</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {items.length} medication{items.length === 1 ? "" : "s"} running low
          {critical > 0 ? ` · ${critical} order now` : ""}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Suggested because stock is running low, worked out from the last 30 days
        of dispensing. This is the pharmacy replenishing itself from a supplier:
        choose Order from supplier to adjust the quantity and pick one; you'll
        confirm before anything is placed. Placing an order does not add stock —
        that happens when the delivery is confirmed as arrived.
      </p>
      <ul className="divide-y">
        {items.map((f) => (
          <li
            key={f.docId}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
          >
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
                {f.onHand} on hand · about {f.daysRemaining} day
                {f.daysRemaining === 1 ? "" : "s"} left at {f.avgDailyUse} a day
              </p>
            </div>
            <QuickReorderForm
              forecast={f}
              clinicId={clinicId}
              clinicName={clinicName}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
