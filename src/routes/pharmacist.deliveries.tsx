import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Truck,
  Plus,
  X,
  Package,
  AlertCircle,
  PackagePlus,
} from "lucide-react";
import {
  useInventory,
  useCurrentPharmacist,
  sendStockDelivery,
  useStockDeliveries,
  addInventoryStock,
  type DeliveryItem,
} from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/pharmacist/deliveries")({
  component: Deliveries,
});

function Deliveries() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  const { stock } = useInventory();

  // Deliveries go to whichever clinic is selected in the header — there is
  // no separate destination picker. Having both meant the header could say
  // "Hillbrow" while you sent stock to Tembisa, which was contradictory.
  const targetClinicId = realClinic.activeClinicId ?? null;
  const targetClinicName = realClinic.activeClinicName;

  const [lines, setLines] = useState<DeliveryItem[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const available = useMemo(() => stock.filter((s) => s.docId), [stock]);

  const { deliveries } = useStockDeliveries(targetClinicId ?? undefined);
  const pending = deliveries.filter((d) => d.status === "Pending");
  const settled = deliveries.filter((d) => d.status !== "Pending");

  const addLine = () => {
    const first = available.find(
      (s) => !lines.some((l) => l.inventoryDocId === s.docId),
    );
    if (!first?.docId) return toast.error("Nothing left to add.");
    setLines([
      ...lines,
      { inventoryDocId: first.docId, name: first.name, quantity: 1 },
    ]);
  };

  const send = async () => {
    if (targetClinicId == null)
      return toast.error("No clinic selected — pick one in the header.");
    if (!pharmacist?.pharmacistId)
      return toast.error("Pharmacist not identified.");
    setSending(true);
    const res = await sendStockDelivery({
      clinicId: targetClinicId,
      pharmacistId: pharmacist.pharmacistId,
      items: lines,
      note: note.trim() || undefined,
    });
    setSending(false);
    if (!res.ok) return toast.error(res.error ?? "Could not send delivery");
    toast.success(
      `Delivery sent to ${targetClinicName ?? "the clinic"} — awaiting confirmation`,
    );
    setLines([]);
    setNote("");
  };

  const canSend =
    !sending &&
    lines.length > 0 &&
    targetClinicId != null &&
    !lines.some((l) => {
      const src = available.find((s) => s.docId === l.inventoryDocId);
      return l.quantity <= 0 || l.quantity > (src?.units ?? 0);
    });

  return (
    <AppShell role="pharmacist" title="Stock Deliveries">
      {/* One clinic context: whatever the header says is where stock goes. */}
      <div className="mb-4 flex items-center gap-2 rounded-lg border bg-secondary/40 px-4 py-2.5">
        <Truck size={15} className="text-muted-foreground shrink-0" />
        <p className="text-sm">
          Sending to <strong>{targetClinicName ?? "no clinic selected"}</strong>
        </p>
        <span className="text-xs text-muted-foreground ml-auto">
          Change the clinic in the header to deliver elsewhere
        </span>
      </div>

      {/* Pharmacy's own restocking — moved here from the Distribution page,
          which is being retired. This is the pharmacy receiving from its
          wholesaler, which is a different thing from sending to a clinic. */}
      <SupplierIntake stock={available} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compose */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold">New delivery</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Stock leaves your shelf immediately. The clinic only gains it once a
            nurse confirms it arrived.
          </p>

          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Medications</label>
            <button
              onClick={addLine}
              className="text-xs font-medium border px-2.5 py-1 rounded-md hover:bg-secondary flex items-center gap-1"
            >
              <Plus size={12} /> Add line
            </button>
          </div>

          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground border rounded-md px-3 py-6 text-center">
              No medications added yet.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((line, i) => {
                const src = available.find(
                  (s) => s.docId === line.inventoryDocId,
                );
                const max = src?.units ?? 0;
                const tooMany = line.quantity > max;
                return (
                  <div key={i} className="flex gap-2 items-start">
                    <select
                      value={line.inventoryDocId}
                      onChange={(e) => {
                        const picked = available.find(
                          (s) => s.docId === e.target.value,
                        );
                        if (!picked?.docId) return;
                        const next = [...lines];
                        next[i] = {
                          ...next[i],
                          inventoryDocId: picked.docId,
                          name: picked.name,
                        };
                        setLines(next);
                      }}
                      className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-white"
                    >
                      {available.map((s) => (
                        <option key={s.docId} value={s.docId}>
                          {s.name} ({s.units} on hand)
                        </option>
                      ))}
                    </select>
                    <div className="w-24">
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...lines];
                          next[i] = {
                            ...next[i],
                            quantity: Math.max(0, Number(e.target.value)),
                          };
                          setLines(next);
                        }}
                        className={`w-full border rounded-md px-2 py-1.5 text-sm ${
                          tooMany ? "border-red-400 bg-red-50" : ""
                        }`}
                      />
                      {tooMany && (
                        <p className="text-[10px] text-red-600 mt-0.5">
                          only {max} left
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <label className="text-sm font-medium block mt-4 mb-1.5">
            Note (optional)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. cold chain — refrigerate on arrival"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />

          <button
            onClick={send}
            disabled={!canSend}
            className="mt-4 w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md text-sm font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
          >
            {sending ? "Sending…" : `Send to ${targetClinicName ?? "clinic"}`}
          </button>
        </div>

        {/* History */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={16} className="text-amber-600" />
              <h3 className="font-semibold">Awaiting confirmation</h3>
              <span className="text-xs text-muted-foreground ml-auto">
                {pending.length}
              </span>
            </div>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nothing in transit.
              </p>
            ) : (
              <ul className="space-y-2">
                {pending.map((d) => (
                  <DeliveryCard key={d.id} d={d} />
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center gap-2 mb-3">
              <Package size={16} className="text-muted-foreground" />
              <h3 className="font-semibold">Completed</h3>
              <span className="text-xs text-muted-foreground ml-auto">
                {settled.length}
              </span>
            </div>
            {settled.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No completed deliveries yet.
              </p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {settled.map((d) => (
                  <DeliveryCard key={d.id} d={d} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function DeliveryCard({ d }: { d: any }) {
  const when = new Date(d.sentAt);
  const validDate = !Number.isNaN(when.getTime());
  return (
    <li className="border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
            d.status === "Pending"
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : d.status === "Confirmed"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          {d.status === "Pending" ? "In transit" : d.status}
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {validDate
            ? when.toLocaleString("en-ZA", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "date not recorded"}
        </span>
      </div>
      <ul className="text-sm">
        {(d.items ?? []).map((it: any, i: number) => (
          <li key={i} className="flex justify-between">
            <span>{it.name}</span>
            <span className="font-medium">{it.quantity}</span>
          </li>
        ))}
      </ul>
      {d.hasDiscrepancy && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-[11px] font-medium text-amber-900">
            Received amount didn't match
          </p>
          {(d.discrepancies ?? []).map((x: any, i: number) => (
            <p key={i} className="text-[11px] text-amber-800">
              {x.name}: sent {x.sent}, received {x.received}
            </p>
          ))}
          {d.discrepancyNote && (
            <p className="text-[11px] text-amber-800 mt-1 italic">
              "{d.discrepancyNote}"
            </p>
          )}
        </div>
      )}
      {d.rejectionReason && (
        <p className="text-[11px] text-red-700 mt-1.5 italic">
          Rejected: {d.rejectionReason}
        </p>
      )}
      {d.confirmedByNurseId && (
        <p className="text-[11px] text-muted-foreground mt-1.5 pt-1.5 border-t">
          {d.status === "Confirmed" ? "Received" : "Rejected"} by{" "}
          {d.confirmedByNurseId}
        </p>
      )}
    </li>
  );
}
function SupplierIntake({
  stock,
}: {
  stock: ReturnType<typeof useInventory>["stock"];
}) {
  const [open, setOpen] = useState(false);
  const [medIdx, setMedIdx] = useState(0);
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);

  const med = stock[medIdx];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0)
      return toast.error("Enter a quantity greater than zero");
    if (!med?.docId)
      return toast.error(
        "That medication isn't linked to an inventory record.",
      );
    setSaving(true);
    try {
      await addInventoryStock(med.docId, n);
      toast.success(
        `${n} × ${med.name} added${supplier ? ` from ${supplier}` : ""}`,
      );
      setQty("");
      setSupplier("");
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not update stock. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-5 mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <PackagePlus size={16} className="text-[oklch(0.55_0.18_245)]" />
        <div>
          <h3 className="font-semibold">Receive stock into the pharmacy</h3>
          <p className="text-xs text-muted-foreground">
            Your own restocking from a wholesaler — separate from sending to a
            clinic.
          </p>
        </div>
        <span className="ml-auto text-xs font-medium border px-3 py-1.5 rounded-md">
          {open ? "Close" : "Add stock"}
        </span>
      </button>

      {open && (
        <form
          onSubmit={submit}
          className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_auto] gap-3 items-end"
        >
          <div>
            <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
              MEDICATION
            </label>
            <select
              value={medIdx}
              onChange={(e) => setMedIdx(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded-md text-sm bg-white"
            >
              {stock.map((s, i) => (
                <option key={s.docId ?? s.name} value={i}>
                  {s.name} ({s.units} on hand)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
              QUANTITY
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 200"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
              SUPPLIER (OPTIONAL)
            </label>
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. Adcock Ingram"
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}
