import { useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";
import { SupplierOrderDialog } from "@/components/SupplierOrderDialog";
import type { MedForecast, StockItem } from "@/lib/pharmacist-service";
import {
  groupStockByMedicine,
  matchesMedicine,
  medicineKey,
  pickOrderLine,
} from "@/lib/stock-groups";

/**
 * ORDER FROM SUPPLIER, started by hand: pick any medicine and order it, whether
 * or not the system has suggested it. The same two-step flow as a suggested
 * order; it places a supplier order and changes no stock.
 */
export function ManualSupplierOrder({
  stock,
  clinicId,
  clinicName,
  forecasts,
}: {
  stock: StockItem[];
  clinicId: number | null;
  clinicName?: string;
  /** Used only to pre-fill a quantity when the system has a figure for it. */
  forecasts: MedForecast[];
}) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState("");
  const [open, setOpen] = useState(false);

  const medicines = useMemo(
    () =>
      groupStockByMedicine(stock)
        .filter((g) => matchesMedicine(g.name, search))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stock, search],
  );
  const med = medicines.find((g) => g.key === chosen) ?? medicines[0];
  const line = med ? pickOrderLine(stock, med.name, clinicId) : undefined;
  const hint = med
    ? forecasts.find((f) => medicineKey(f.name) === med.key)
    : undefined;

  return (
    <div data-testid="manual-supplier-order">
      <p className="mb-3 text-xs text-muted-foreground">
        Replenish the pharmacy from a supplier. Choose any medicine; nothing is
        sent to a clinic, and stock goes up when the delivery is confirmed as
        arrived.
      </p>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Find a medicine…"
        aria-label="Search medicines to order"
        className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
      />
      <select
        value={med?.key ?? ""}
        onChange={(e) => setChosen(e.target.value)}
        aria-label="Medicine to order"
        className="mb-3 w-full rounded-md border bg-white px-3 py-2 text-sm"
      >
        {medicines.length === 0 && (
          <option value="">No medicine matches</option>
        )}
        {medicines.map((g) => (
          <option key={g.key} value={g.key}>
            {g.name} ({g.totalUnits.toLocaleString()} in pharmacy)
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!med || !line}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-white py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-50"
      >
        <PackagePlus size={15} /> Order from supplier…
      </button>
      {med && line && (
        <SupplierOrderDialog
          open={open}
          onClose={() => setOpen(false)}
          medName={med.name}
          clinicId={line.clinicId ?? clinicId ?? undefined}
          clinicName={
            line.clinicId != null && line.clinicId === clinicId
              ? clinicName
              : undefined
          }
          inventoryDocId={line.docId}
          currentUnits={line.units}
          suggestedQty={hint?.suggestedOrder ?? 0}
        />
      )}
    </div>
  );
}
