import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  sendStockDelivery,
  type DeliveryItem,
  type StockItem,
} from "@/lib/pharmacist-service";

/**
 * SEND TO CLINIC, started by hand: pick medicines and quantities from the
 * pharmacy's stock and send them to the clinic selected in the header. Stock
 * leaves the shelf now; the clinic gains it when a nurse confirms it arrived.
 */
export function SendToClinicForm({
  available,
  clinicId,
  clinicName,
  pharmacistId,
}: {
  available: StockItem[];
  clinicId: number | null;
  clinicName?: string;
  pharmacistId?: string;
}) {
  const [lines, setLines] = useState<DeliveryItem[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

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
    if (clinicId == null)
      return toast.error("No clinic selected — pick one in the header.");
    if (!pharmacistId) return toast.error("Pharmacist not identified.");
    setSending(true);
    // sendStockDelivery throws when offline, so catch it here rather than
    // leaving the button stuck on "sending".
    try {
      const res = await sendStockDelivery({
        clinicId,
        pharmacistId,
        items: lines,
        note: note.trim() || undefined,
      });
      if (!res.ok) return toast.error(res.error ?? "Could not send delivery");
      toast.success(
        `Sent to ${clinicName ?? "the clinic"} — awaiting confirmation`,
      );
      setLines([]);
      setNote("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send delivery",
      );
    } finally {
      setSending(false);
    }
  };

  const canSend =
    !sending &&
    lines.length > 0 &&
    clinicId != null &&
    !lines.some((l) => {
      const src = available.find((s) => s.docId === l.inventoryDocId);
      return l.quantity <= 0 || l.quantity > (src?.units ?? 0);
    });

  return (
    <div data-testid="send-to-clinic-form">
      <p className="mb-3 text-xs text-muted-foreground">
        Send the pharmacy's own stock out to {clinicName ?? "the clinic"}. It
        leaves your shelf immediately; the clinic only gains it once a nurse
        confirms it arrived.
      </p>

      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm font-medium">Medications</label>
        <button
          type="button"
          onClick={addLine}
          className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
        >
          <Plus size={12} /> Add line
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-md border px-3 py-6 text-center text-xs text-muted-foreground">
          No medications added yet.
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((line, i) => {
            const src = available.find((s) => s.docId === line.inventoryDocId);
            const max = src?.units ?? 0;
            const tooMany = line.quantity > max;
            return (
              <div key={i} className="flex items-start gap-2">
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
                  className="flex-1 rounded-md border bg-white px-2 py-1.5 text-sm"
                >
                  {available.map((s) => (
                    <option key={s.docId} value={s.docId}>
                      {s.name} ({s.units} in pharmacy)
                    </option>
                  ))}
                </select>
                <div className="w-24">
                  <input
                    type="number"
                    min={1}
                    value={line.quantity === 0 ? "" : line.quantity}
                    placeholder="Qty"
                    onChange={(e) => {
                      const next = [...lines];
                      next[i] = {
                        ...next[i],
                        quantity: Math.max(0, Number(e.target.value)),
                      };
                      setLines(next);
                    }}
                    className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                      tooMany ? "border-red-400 bg-red-50" : ""
                    }`}
                  />
                  {tooMany && (
                    <p className="mt-0.5 text-[10px] text-red-600">
                      only {max} left
                    </p>
                  )}
                </div>
                <button
                  type="button"
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

      <label className="mb-1.5 mt-4 block text-sm font-medium">
        Note (optional)
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. cold chain — refrigerate on arrival"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />

      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        className="mt-4 w-full rounded-md bg-[oklch(0.18_0.06_260)] py-2.5 text-sm font-medium text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
      >
        {sending ? "Sending…" : `Send to ${clinicName ?? "clinic"}`}
      </button>
    </div>
  );
}
