import { useEffect, useState } from "react";
import { OrderFlowDialog } from "@/components/OrderFlowDialog";
import { quickReorder, useCurrentPharmacist } from "@/lib/pharmacist-service";
import { OTHER_SUPPLIER, SUPPLIERS, resolveSupplier } from "@/lib/suppliers";
import { toast } from "sonner";

const fieldClass =
  "w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]";

/**
 * ORDER FROM SUPPLIER: the pharmacy replenishing its own stock from an outside
 * supplier. (Sending stock to a clinic is a different thing, "Send to clinic".)
 * Two deliberate steps:
 *   1. the quantity (starting at the suggestion, adjustable) and the supplier;
 *   2. a plain summary of what is about to be ordered, confirmed once more.
 * Placing it creates a pending delivery. It does NOT add stock: that happens
 * when someone confirms the delivery arrived (Deliveries page).
 */
export function SupplierOrderDialog({
  open,
  onClose,
  medName,
  clinicId,
  clinicName,
  inventoryDocId,
  currentUnits,
  suggestedQty,
}: {
  open: boolean;
  onClose: () => void;
  medName: string;
  clinicId: number | undefined;
  clinicName?: string;
  inventoryDocId: string | undefined;
  currentUnits: number;
  suggestedQty: number;
}) {
  const { pharmacist } = useCurrentPharmacist();
  const [qty, setQty] = useState(suggestedQty > 0 ? String(suggestedQty) : "");
  const [choice, setChoice] = useState(SUPPLIERS[0] ?? OTHER_SUPPLIER);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setQty(suggestedQty > 0 ? String(suggestedQty) : "");
      setChoice(SUPPLIERS[0] ?? OTHER_SUPPLIER);
      setTyped("");
    }
  }, [open, suggestedQty]);

  const n = Number(qty);
  const qtyOk = Number.isInteger(n) && n > 0;
  const supplier = resolveSupplier(choice, typed);
  const actor =
    pharmacist?.fullName || pharmacist?.pharmacistId || "pharmacist";

  return (
    <OrderFlowDialog
      open={open}
      onClose={onClose}
      title={`Order ${medName} from a supplier`}
      description="Choose how many to order and from whom. You'll see a summary before anything is placed."
      canContinue={qtyOk && !!supplier && !!inventoryDocId && clinicId != null}
      continueLabel="Review order"
      summaryTitle="Place this order with the supplier?"
      summary={[
        { label: "Medication", value: medName },
        {
          label: "Quantity",
          value: `${qtyOk ? n.toLocaleString() : "—"} units`,
        },
        { label: "Supplier", value: supplier || "—" },
        ...(clinicName ? [{ label: "For", value: clinicName }] : []),
        {
          label: "On hand now",
          value: `${currentUnits.toLocaleString()} units`,
        },
      ]}
      reassurance="This places the order with the supplier and lists it as a delivery on the way. Nothing is sent to a clinic, and your stock doesn't change until you confirm the delivery has arrived, on the Deliveries page."
      confirmLabel="Order from supplier"
      onConfirm={async () => {
        if (!inventoryDocId || clinicId == null) {
          throw new Error(
            "That medication isn't linked to an inventory record.",
          );
        }
        await quickReorder({
          clinicId,
          inventoryDocId,
          medName,
          currentUnits,
          suggestedQty,
          orderedQty: n,
          supplier,
          by: actor,
        });
        toast.success(`Ordered ${n} × ${medName} from ${supplier}`, {
          description:
            "It's now listed as a delivery on the way. Confirm it on Deliveries when it arrives.",
        });
      }}
      details={
        <>
          <div>
            <label
              htmlFor="order-qty"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Quantity to order
            </label>
            <input
              id="order-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`${fieldClass} ${qtyOk ? "" : "border-red-400 bg-red-50"}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {suggestedQty > 0
                ? `Suggested: ${suggestedQty.toLocaleString()} (from the last 30 days of dispensing). Change it if you need to.`
                : "No suggestion for this one — enter the amount you need."}
            </p>
          </div>
          <div>
            <label
              htmlFor="order-supplier"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Supplier
            </label>
            <select
              id="order-supplier"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className={fieldClass}
            >
              {SUPPLIERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={OTHER_SUPPLIER}>Other…</option>
            </select>
            {choice === OTHER_SUPPLIER && (
              <input
                aria-label="Supplier name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Supplier name"
                className={`${fieldClass} mt-2`}
              />
            )}
          </div>
        </>
      }
    />
  );
}
