import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { toast } from "sonner";
import {
  Package,
  Check,
  X,
  Plus,
  Boxes,
  Search,
  MapPin,
  ArrowRight,
} from "lucide-react";
import { useCurrentNurse } from "@/lib/nurse-service";
import {
  useStockDeliveries,
  confirmStockDelivery,
  rejectStockDelivery,
  recordExternalStock,
  useInventory,
  findMedicationAtOtherClinics,
  type StockDelivery,
  type StockElsewhere,
} from "@/lib/pharmacist-service";

export const Route = createFileRoute("/nurse/stock")({ component: NurseStock });

function NurseStock() {
  const { nurse } = useCurrentNurse();
  const { deliveries } = useStockDeliveries(nurse?.clinicId);
  const { stock } = useInventory();

  const [historyQuery, setHistoryQuery] = useState("");

  const pending = deliveries.filter((d) => d.status === "Pending");
  const history = deliveries
    .filter((d) => d.status !== "Pending")
    .filter((d) => {
      if (!historyQuery.trim()) return true;
      const needle = historyQuery.toLowerCase().replace("#", "");
      const ref = String(d.id ?? "")
        .slice(-6)
        .toLowerCase();
      return (
        ref.includes(needle) ||
        (d.items ?? []).some((i) =>
          String(i.name ?? "")
            .toLowerCase()
            .includes(needle),
        )
      );
    });

  const [showExternal, setShowExternal] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(5);
  const [stockQuery, setStockQuery] = useState("");

  const clinicStock = stock.filter(
    (s) =>
      (nurse?.clinicId == null || s.clinicId === nurse.clinicId) &&
      (!stockQuery.trim() ||
        s.name.toLowerCase().includes(stockQuery.toLowerCase())),
  );

  return (
    <AppShell
      role="nurse"
      title="Stock"
      staffNameOverride={nurse?.fullName}
      clinicNameOverride={nurse?.clinicName}
    >
      {/* Deliveries waiting to be checked in — the whole point of this page,
          so it sits at the top and can't be missed. */}
      <div className="bg-white rounded-xl border p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Package size={16} className="text-amber-600" />
          <h3 className="font-semibold">Deliveries to confirm</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {pending.length} waiting
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Stock is only added to the clinic once you confirm it physically
          arrived. Correct the quantities if less turned up than was sent.
        </p>

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nothing waiting. Deliveries appear here when a pharmacy sends stock
            to this clinic.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((d) => (
              <PendingDelivery
                key={d.id}
                delivery={d}
                nurseId={nurse?.nurseId ?? ""}
                clinicId={nurse?.clinicId ?? 0}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Nurses described this as a real daily problem: a patient needs
          something the clinic has run out of, and there's no way to know
          whether another clinic has it without phoning around. */}
      <FindElsewhere clinicId={nurse?.clinicId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current stock */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <Boxes size={16} className="text-muted-foreground" />
            <h3 className="font-semibold">Stock on hand</h3>
            <div className="relative ml-auto">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder="Search…"
                className="border rounded-md pl-8 pr-2 py-1 text-xs w-36"
              />
            </div>
          </div>
          {clinicStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {stockQuery ? "No match." : "No stock recorded yet."}
            </p>
          ) : (
            <ul className="divide-y max-h-80 overflow-y-auto">
              {clinicStock.map((s) => (
                <li
                  key={s.docId ?? s.name}
                  className="flex justify-between py-2 text-sm"
                >
                  <span>{s.name}</span>
                  <span className="font-semibold">{s.units}</span>
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={() => setShowExternal((v) => !v)}
            className="mt-3 w-full text-xs font-medium border py-2 rounded-md hover:bg-secondary flex items-center justify-center gap-1"
          >
            <Plus size={12} /> Record delivery from a supplier not on Zennith
          </button>

          {showExternal && (
            <ExternalStockForm
              clinicId={nurse?.clinicId ?? 0}
              nurseId={nurse?.nurseId ?? ""}
              onDone={() => setShowExternal(false)}
              knownMedications={[
                ...new Set(stock.map((s) => s.name).filter(Boolean)),
              ].sort()}
            />
          )}
        </div>

        {/* History */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h3 className="font-semibold">Delivery history</h3>
            <span className="text-xs text-muted-foreground">
              {history.length}
            </span>
            <input
              value={historyQuery}
              onChange={(e) => {
                setHistoryQuery(e.target.value);
                setHistoryLimit(5);
              }}
              placeholder="Search medication or #ref…"
              className="ml-auto border rounded-md px-2.5 py-1 text-xs w-44"
            />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No past deliveries.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {history.slice(0, historyLimit).map((d) => (
                  <li key={d.id} className="border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono bg-secondary px-1.5 py-0.5 rounded">
                        #
                        {String(d.id ?? "")
                          .slice(-6)
                          .toUpperCase()}
                      </span>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          d.status === "Confirmed"
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-red-50 text-red-800 border-red-200"
                        }`}
                      >
                        {d.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {formatWhen(d.sentAt)}
                      </span>
                    </div>
                    <ul className="text-sm">
                      {(d.items ?? []).map((it, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{it.name}</span>
                          <span className="font-medium">{it.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 mt-3">
                {history.length > historyLimit && (
                  <button
                    onClick={() => setHistoryLimit((n) => n + 10)}
                    className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                  >
                    Show more ({history.length - historyLimit} older)
                  </button>
                )}
                {historyLimit > 5 && (
                  <button
                    onClick={() => setHistoryLimit(5)}
                    className="flex-1 text-xs border py-2 rounded-md hover:bg-secondary"
                  >
                    Collapse
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function formatWhen(raw: string) {
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? "date not recorded"
    : d.toLocaleString("en-ZA", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function PendingDelivery({
  delivery,
  nurseId,
  clinicId,
}: {
  delivery: StockDelivery;
  nurseId: string;
  clinicId: number;
}) {
  // Received quantities start at what was sent, but stay editable — short
  // deliveries are normal and silently accepting the sent figure would put
  // the clinic's records permanently out of step with the shelf.
  const [received, setReceived] = useState<Record<string, number>>(
    Object.fromEntries((delivery.items ?? []).map((i) => [i.name, i.quantity])),
  );
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const confirm = async () => {
    if (changed && !note.trim()) {
      return toast.error(
        "Quantities don't match what was sent — please explain the difference.",
      );
    }
    setBusy(true);
    // confirmStockDelivery now THROWS when offline (assertOnline) rather than
    // returning { ok: false }, so without this catch the rejection would be
    // unhandled and the button would stay stuck on busy.
    try {
      const res = await confirmStockDelivery({
        deliveryId: delivery.id,
        nurseId,
        clinicId,
        receivedItems: Object.entries(received).map(([name, quantity]) => ({
          name,
          quantity,
        })),
        discrepancyNote: changed ? note.trim() : undefined,
      });
      if (!res.ok) return toast.error(res.error ?? "Could not confirm");
      toast.success(
        changed
          ? "Confirmed with a recorded difference — the pharmacy will see it"
          : "Delivery confirmed — stock added",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not confirm");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!reason.trim()) return toast.error("Give a reason for rejecting.");
    setBusy(true);
    try {
      const res = await rejectStockDelivery(
        delivery.id,
        nurseId,
        reason.trim(),
      );
      if (!res.ok) return toast.error(res.error ?? "Could not reject");
      toast.success("Delivery rejected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reject");
    } finally {
      setBusy(false);
    }
  };

  const changed = (delivery.items ?? []).some(
    (i) => received[i.name] !== i.quantity,
  );

  return (
    <li className="border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        {/* Same short reference the pharmacy sees, so both sides can quote
            the same delivery on a phone call. */}
        <span className="text-[10px] font-mono bg-secondary px-1.5 py-0.5 rounded">
          #
          {String(delivery.id ?? "")
            .slice(-6)
            .toUpperCase()}
        </span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200">
          In transit
        </span>
        <span className="text-[11px] text-muted-foreground">
          from {delivery.sentByPharmacistId ?? "outside supplier"}
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {formatWhen(delivery.sentAt)}
        </span>
      </div>

      {delivery.note && (
        <p className="text-xs bg-secondary/50 rounded px-2 py-1.5 mb-3">
          {delivery.note}
        </p>
      )}

      <table className="w-full text-sm mb-3">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="font-medium pb-1">Medication</th>
            <th className="font-medium pb-1 w-20">Sent</th>
            <th className="font-medium pb-1 w-24">Received</th>
          </tr>
        </thead>
        <tbody>
          {(delivery.items ?? []).map((it) => (
            <tr key={it.name}>
              <td className="py-1">{it.name}</td>
              <td className="py-1 text-muted-foreground">{it.quantity}</td>
              <td className="py-1">
                <input
                  type="number"
                  min={0}
                  value={received[it.name] ?? 0}
                  onChange={(e) =>
                    setReceived({
                      ...received,
                      [it.name]: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className={`w-20 border rounded px-2 py-1 text-sm ${
                    received[it.name] !== it.quantity
                      ? "border-amber-400 bg-amber-50"
                      : ""
                  }`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {changed && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900 mb-1.5">
            This doesn't match what was sent
          </p>
          <p className="text-[11px] text-amber-800 mb-2">
            Say what happened. The pharmacy sees this, and it's flagged for
            review — so short deliveries get investigated rather than quietly
            written off.
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. one box damaged in transit, 1 unit missing from seal"
            className="w-full border rounded-md px-3 py-2 text-sm bg-white"
          />
        </div>
      )}

      {rejecting ? (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being rejected?"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setRejecting(false)}
              className="flex-1 border py-2 rounded-md text-xs"
            >
              Back
            </button>
            <button
              onClick={reject}
              disabled={busy}
              className="flex-1 bg-red-600 text-white py-2 rounded-md text-xs disabled:opacity-50"
            >
              Confirm rejection
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="text-xs font-medium border px-3 py-2 rounded-md hover:bg-secondary flex items-center gap-1"
          >
            <X size={13} /> Reject
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="flex-1 text-xs font-medium bg-emerald-600 text-white px-3 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            <Check size={13} /> {busy ? "Confirming…" : "Confirm received"}
          </button>
        </div>
      )}
    </li>
  );
}

function ExternalStockForm({
  clinicId,
  nurseId,
  onDone,
  knownMedications,
}: {
  clinicId: number;
  nurseId: string;
  onDone: () => void;
  knownMedications: string[];
}) {
  const [medName, setMedName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await recordExternalStock({
        clinicId,
        nurseId,
        medName: medName.trim(),
        quantity: Number(quantity),
        source: source.trim() || "Outside supplier",
      });
      if (!res.ok) return toast.error(res.error ?? "Could not record stock");
      toast.success(`${quantity} × ${medName} added to clinic stock`);
      setMedName("");
      setQuantity("");
      setSource("");
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not record stock",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 border rounded-md p-3 space-y-2">
      <p className="text-xs text-muted-foreground">
        For a supplier who isn't on Zennith. This is recorded against your name
        and reviewed by your clinic admin — supplier name is required.
      </p>
      {/* Suggests medications already stocked at this clinic. Free-typing is
          still allowed for genuinely new items, but matching an existing name
          exactly matters — a typo creates a duplicate inventory row instead
          of adding to the existing one. */}
      <input
        required
        list="known-medications"
        value={medName}
        onChange={(e) => setMedName(e.target.value)}
        placeholder="Start typing a medication name…"
        className="w-full border rounded-md px-3 py-2 text-sm"
      />
      <datalist id="known-medications">
        {knownMedications.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <input
          required
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Qty"
          className="w-24 border rounded-md px-3 py-2 text-sm"
        />
        <input
          required
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Supplier name"
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2 rounded-md text-xs disabled:opacity-50"
      >
        {busy ? "Recording…" : "Add to clinic stock"}
      </button>
    </form>
  );
}
function FindElsewhere({ clinicId }: { clinicId?: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockElsewhere[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await findMedicationAtOtherClinics(query, clinicId);
      setResults(rows);
    } catch (err) {
      console.error("Cross-clinic lookup failed:", err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <MapPin size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Out of something? Find it nearby</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Shows which other clinics currently have a medication in stock, so you
        can direct a patient instead of turning them away.
      </p>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Medication name — e.g. Metformin"
          className="flex-1 border rounded-md px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {results !== null && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              No other clinic currently has "{query}" in stock.
            </p>
          ) : (
            <>
              <p className="text-[11px] tracking-wider text-muted-foreground mb-2">
                AVAILABLE AT {results.length} OTHER CLINIC
                {results.length === 1 ? "" : "S"}
              </p>
              <ul className="divide-y border rounded-lg">
                {results.slice(0, 8).map((r, i) => (
                  <li
                    key={`${r.clinicId}-${i}`}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <ArrowRight
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.clinicName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.medName}
                      </p>
                    </div>
                    <span className="text-sm font-semibold shrink-0">
                      {r.quantity}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Deliberately no "request transfer" button — moving stock
                  between public facilities has real governance rules, and
                  the app shouldn't imply it can be done with a click. */}
              <p className="text-[11px] text-muted-foreground mt-2">
                Contact the clinic directly to arrange a transfer.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
