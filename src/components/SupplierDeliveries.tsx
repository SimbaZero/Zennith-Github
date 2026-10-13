import { useMemo, useState } from "react";
import { PackageCheck, PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/Loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { matchesMedicine as matchesSearch } from "@/lib/stock-groups";
import {
  addInventoryStock,
  cancelSupplierOrder,
  canConfirmDelivery,
  receiveSupplierOrder,
  type StockItem,
  type SupplierOrder,
} from "@/lib/pharmacist-service";

const when = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("en-ZA", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "date not recorded";
};

/**
 * The pharmacy receiving from its suppliers:
 *   - orders that were placed and haven't arrived, each confirmed by typing in
 *     what actually arrived;
 *   - a way to book in stock that arrived with no order behind it.
 * One search box narrows both to a medicine. (Deliveries that have been
 * received are in the delivery history, which sits at the foot of the page.)
 *
 * Stock goes up in exactly two places here, and only for a pharmacist or admin:
 * confirming a delivery, and booking in stock by hand.
 */
export function SupplierDeliveries({
  orders,
  stock,
  actor,
  role,
}: {
  orders: SupplierOrder[];
  stock: StockItem[];
  /** The confirming person's name, for the record. */
  actor: string;
  /** Their role from the session; decides whether they may confirm. null = not known yet. */
  role: string | null;
}) {
  const [search, setSearch] = useState("");
  const [receiving, setReceiving] = useState<SupplierOrder | null>(null);
  const allowed = canConfirmDelivery(role);

  const expected = useMemo(
    () =>
      orders.filter(
        (o) => o.status === "ordered" && matchesSearch(o.medName, search),
      ),
    [orders, search],
  );
  return (
    <section
      className="bg-white rounded-xl border p-5 mb-6"
      aria-label="Deliveries from suppliers"
      data-testid="supplier-deliveries"
    >
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <PackageCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
        <div className="min-w-0">
          <h3 className="font-semibold">Deliveries from suppliers</h3>
          <p className="text-xs text-muted-foreground">
            Orders placed with a supplier. Pharmacy stock only goes up here,
            when you confirm what actually arrived.
          </p>
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search
            size={14}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a medicine…"
            aria-label="Search receiving"
            className="w-full rounded-md border py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {role != null && !allowed && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Only a pharmacist or an admin can confirm that a delivery arrived.
        </p>
      )}

      <h4 className="mt-4 mb-2 text-[11px] font-medium tracking-wider text-muted-foreground">
        ON ITS WAY FROM SUPPLIERS ({expected.length})
      </h4>
      {expected.length === 0 ? (
        <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
          {search.trim()
            ? `No expected delivery matches "${search.trim()}".`
            : "No orders are waiting to arrive."}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="expected-deliveries">
          {expected.map((o) => (
            <li
              key={o.docId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-medium">{o.medName}</p>
                <p className="text-xs text-muted-foreground">
                  {o.orderedQty.toLocaleString()} ordered
                  {o.supplier ? ` from ${o.supplier}` : ""} ·{" "}
                  {when(o.orderedAt)}
                  {o.orderedBy ? ` · by ${o.orderedBy}` : ""}
                </p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                In transit
              </span>
              {allowed && (
                <button
                  type="button"
                  onClick={() => setReceiving(o)}
                  className="rounded-md bg-[oklch(0.18_0.06_260)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[oklch(0.25_0.08_260)]"
                >
                  Confirm delivery arrived
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ManualIntake stock={stock} search={search} allowed={allowed} />

      <ReceiveDialog
        order={receiving}
        actor={actor}
        onClose={() => setReceiving(null)}
      />
    </section>
  );
}

/** Confirming one delivery: the amount that actually arrived is typed, never pre-filled. */
function ReceiveDialog({
  order,
  actor,
  onClose,
}: {
  order: SupplierOrder | null;
  actor: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      {order && (
        <ReceiveForm
          key={order.docId}
          order={order}
          actor={actor}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ReceiveForm({
  order,
  actor,
  onClose,
}: {
  order: SupplierOrder;
  actor: string;
  onClose: () => void;
}) {
  // Empty on purpose: the person counts what is in front of them and types it.
  // Pre-filling the ordered figure would make "confirm" a rubber stamp.
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isInteger(n) && n > 0;
  const differs = valid && n !== order.orderedQty;
  const diff = valid ? n - order.orderedQty : 0;

  const confirm = async () => {
    setBusy(true);
    setProblem("");
    try {
      const res = await receiveSupplierOrder({
        orderDocId: order.docId,
        receivedQty: n,
        by: actor,
        note: note.trim() || undefined,
      });
      toast.success(
        `${res.receivedQty} × ${res.medName} added to stock — now ${res.newUnits.toLocaleString()} on that line`,
      );
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Couldn't record that. Nothing was changed — please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    setBusy(true);
    setProblem("");
    try {
      await cancelSupplierOrder({ orderDocId: order.docId, by: actor });
      toast.success(`Order for ${order.medName} cancelled`);
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Couldn't cancel the order.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      data-testid="receive-dialog"
      className="max-w-md"
      onInteractOutside={(e) => busy && e.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>Confirm delivery of {order.medName}</DialogTitle>
        <DialogDescription>
          {order.orderedQty.toLocaleString()} ordered
          {order.supplier ? ` from ${order.supplier}` : ""}. Count what actually
          arrived and enter it below.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="received-qty"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Units actually received
          </label>
          <input
            id="received-qty"
            type="number"
            min={1}
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="Type the number you counted"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          />
        </div>
        {differs && (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 p-3"
            data-testid="receive-differs"
          >
            <p className="text-sm text-amber-900">
              That's {Math.abs(diff).toLocaleString()}{" "}
              {diff < 0 ? "fewer" : "more"} than ordered. Please say why, so
              it's on the record.
            </p>
            <input
              aria-label="Why it differs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="e.g. one box missing; back-ordered by the supplier"
              className="mt-2 w-full rounded-md border bg-white px-3 py-2 text-sm"
            />
          </div>
        )}
        {problem && (
          <p
            role="alert"
            data-testid="receive-problem"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {problem}
          </p>
        )}
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        <button
          type="button"
          onClick={cancelOrder}
          disabled={busy}
          className="mr-auto text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
        >
          This isn't coming — cancel the order
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-md border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-60"
        >
          Not yet
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || !valid || (differs && !note.trim())}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Spinner />}
          {busy ? "Recording…" : "Confirm and add to stock"}
        </button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Stock that arrived with no order behind it (a donation, a transfer, a correction):
 * book it in by hand. The medicine is chosen from a list the search box narrows.
 */
function ManualIntake({
  stock,
  search,
  allowed,
}: {
  stock: StockItem[];
  search: string;
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [docId, setDocId] = useState("");
  const [qty, setQty] = useState("");
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () =>
      stock
        .filter((s) => s.docId && matchesSearch(s.name, search))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stock, search],
  );
  const med = options.find((s) => s.docId === docId) ?? options[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0)
      return toast.error("Enter a whole number of units above 0");
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
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not update stock. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return null;
  return (
    <div className="mt-5 border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <PackagePlus size={15} className="text-muted-foreground" />
        <span className="text-sm font-medium">
          Stock arrived with no order?
        </span>
        <span className="ml-auto rounded-md border px-3 py-1 text-xs font-medium">
          {open ? "Close" : "Add stock"}
        </span>
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-[2fr_1fr_1.5fr_auto]"
        >
          <div>
            <label className="mb-1 block text-[11px] tracking-wider text-muted-foreground">
              MEDICATION{search.trim() ? ` (matching "${search.trim()}")` : ""}
            </label>
            <select
              value={med?.docId ?? ""}
              onChange={(e) => setDocId(e.target.value)}
              className="w-full rounded-md border bg-white px-3 py-2 text-sm"
              aria-label="Medication to add"
            >
              {options.length === 0 && (
                <option value="">No medication matches</option>
              )}
              {options.map((s) => (
                <option key={s.docId} value={s.docId}>
                  {s.name} ({s.units} in pharmacy)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] tracking-wider text-muted-foreground">
              QUANTITY
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 200"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] tracking-wider text-muted-foreground">
              FROM (OPTIONAL)
            </label>
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="e.g. transfer from Berea"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !med}
            className="rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm text-white hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}
