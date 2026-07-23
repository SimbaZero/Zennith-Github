import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useStock, useAllocations, saveAllocation, addStock, nurses, usualQuantityFor, queueDistribution, usePending, confirmReceipt } from "@/lib/store";
import { CLINICS, useActiveClinic } from "@/lib/clinic";
import { toast } from "sonner";
import { AlertTriangle, Plus, Send, PackageCheck } from "lucide-react";

export const Route = createFileRoute("/pharmacist/distribution")({ component: Distribution });

function SupplierIntake() {
  const stock = useStock();
  const [medIdx, setMedIdx] = useState(0);
  const [qty, setQty] = useState<string>("");
  const [supplier, setSupplier] = useState("");

  const med = stock[medIdx];
  // Pre-fill the "usual amount" for this med so nurses/pharmacists can verify & click.
  useEffect(() => {
    const usual = usualQuantityFor(med.name) ?? med.avgDay ?? 0;
    setQty(usual > 0 ? String(usual) : "");
  }, [medIdx, med.name, med.avgDay]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      return toast.error("Enter a positive quantity to add");
    }
    addStock(med.name, n);
    toast.success(`Added ${n} units of ${med.name}${supplier ? ` from ${supplier}` : ""}`);
    setQty("");
    setSupplier("");
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Plus size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Receive Stock from Supplier</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Log incoming stock — the selected medication's available quantity will increase.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_auto] gap-3 items-end">
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Medication</label>
          <select
            value={medIdx}
            onChange={(e) => setMedIdx(Number(e.target.value))}
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          >
            {stock.map((s, i) => (
              <option key={s.name} value={i}>{s.name} ({s.units} on hand)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Quantity to add</label>
          <input
            type="number"
            min={1}
            value={qty}
            placeholder={String(usualQuantityFor(med.name) ?? med.avgDay ?? "e.g. 200")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return setQty("");
              const num = Number(v);
              if (!Number.isFinite(num) || num < 0) {
                toast.error("Negative values are not allowed");
                return;
              }
              setQty(String(num));
            }}
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          />
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Supplier (optional)</label>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="e.g. Adcock Ingram"
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          />
        </div>
        <button
          type="submit"
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] flex items-center gap-1.5"
        >
          <Plus size={14} /> Add to stock
        </button>
      </form>
    </div>
  );
}

function SendToClinic() {
  const stock = useStock();
  const pending = usePending();
  const active = useActiveClinic();
  const [medIdx, setMedIdx] = useState(0);
  const [clinic, setClinic] = useState(active.id);
  const [qty, setQty] = useState<string>("");
  useEffect(() => setClinic(active.id), [active.id]);

  const med = stock[medIdx];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a positive quantity");
    if (n > med.units) return toast.error(`Only ${med.units} units available in central stock`);
    queueDistribution({ med: med.name, units: n, clinic, from: "Pharmacy Hub" });
    toast.success(`Sent ${n} × ${med.name} to ${CLINICS.find((c) => c.id === clinic)?.name} — awaiting nurse receipt`);
    setQty("");
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Send size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Distribute Stock to a Clinic</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Sends stock to a clinic in a <strong>pending</strong> state. A nurse at that clinic must
        confirm receipt before it appears in their on-hand inventory.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-[2fr_1.4fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Medication</label>
          <select value={medIdx} onChange={(e) => setMedIdx(Number(e.target.value))}
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]">
            {stock.map((s, i) => (<option key={s.name} value={i}>{s.name} ({s.units} avail.)</option>))}
          </select>
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Destination clinic</label>
          <select value={clinic} onChange={(e) => setClinic(e.target.value as typeof clinic)}
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]">
            {CLINICS.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Quantity</label>
          <input type="number" min={1} value={qty} onChange={(e) => {
            const v = e.target.value;
            if (v === "") return setQty("");
            const num = Number(v);
            if (!Number.isFinite(num) || num < 0) { toast.error("Negative values are not allowed"); return; }
            setQty(String(num));
          }} className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]" />
        </div>
        <button className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] flex items-center gap-1.5">
          <Send size={14} /> Send
        </button>
      </form>

      {pending.length > 0 && (
        <div className="mt-5 pt-5 border-t">
          <p className="text-[11px] tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <PackageCheck size={12} /> IN TRANSIT · AWAITING NURSE RECEIPT
          </p>
          <ul className="divide-y">
            {pending.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{p.med}</span>
                  <span className="text-muted-foreground"> · {p.units} units → {CLINICS.find((c) => c.id === p.clinic)?.name}</span>
                </div>
                <button
                  onClick={() => { confirmReceipt(p.id); toast.info("Manually marked received (nurse action)"); }}
                  className="text-xs border px-2 py-1 rounded-md hover:bg-secondary"
                >Force receipt</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Distribution() {
  const stock = useStock();
  const savedAllocations = useAllocations();
  const [medIdx, setMedIdx] = useState(0);
  // null means "not yet entered" — we won't auto-fill 0
  const [alloc, setAlloc] = useState<Record<string, number | null>>({
    Olorato: null,
    Nobuhle: null,
    Michelle: null,
  });

  const med = stock[medIdx];

  // Pre-load saved allocation for the selected med (if any); otherwise use
  // smart defaults derived from the mean of prior allocations for this med.
  useEffect(() => {
    const existing = savedAllocations.find((a) => a.med === med.name);
    if (existing) {
      setAlloc({ ...existing.nurses });
      return;
    }
    // Smart defaults: average this med's history across nurses, rounded.
    const history = savedAllocations.filter((a) => a.med === med.name);
    if (history.length === 0) {
      setAlloc({ Olorato: null, Nobuhle: null, Michelle: null });
      return;
    }
    const avg: Record<string, number | null> = {};
    for (const n of nurses) {
      const vals = history.map((h) => h.nurses[n]).filter((v): v is number => typeof v === "number");
      avg[n] = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    }
    setAlloc(avg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medIdx]);


  const total = nurses.reduce((s, n) => s + (alloc[n] ?? 0), 0);
  const over = total > med.units;
  const missing = nurses.filter((n) => alloc[n] === null);

  // Notify the pharmacist about any nurse with a missing value
  useEffect(() => {
    if (missing.length > 0) {
      const t = setTimeout(() => {
        toast.warning(
          `Missing allocation for ${missing.join(", ")} — please enter a value (use 0 if none)`,
          { id: `missing-${med.name}` },
        );
      }, 600);
      return () => clearTimeout(t);
    }
  }, [missing.join(","), med.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (over) return toast.error("Total exceeds available stock");
    if (missing.length > 0) {
      return toast.error(
        `Cannot save — ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no value. Enter 0 if none.`,
      );
    }
    saveAllocation(med.name, alloc);
    toast.success(`Distribution saved · ${total} units deducted from stock`);
  };

  const allocationsForDisplay = useMemo(() => savedAllocations, [savedAllocations]);

  return (
    <AppShell role="pharmacist" title="Stock Distribution">
      <div className="space-y-6">
        <SupplierIntake />
        <SendToClinic />
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold">Distribute Stock to Nurses</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-5">Assign medication quantities to nurses. Each nurse must have a value — enter <strong>0</strong> if they should receive nothing.</p>

          <label className="text-sm font-medium block mb-1.5">Medication</label>
          <select
            value={medIdx}
            onChange={(e) => setMedIdx(Number(e.target.value))}
            className="w-full px-3 py-2.5 border rounded-md mb-4 outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          >
            {stock.map((s, i) => (
              <option key={s.name} value={i}>{s.name} ({s.units} available)</option>
            ))}
          </select>

          <div className="space-y-3">
            {nurses.map((n) => {
              const isNull = alloc[n] === null;
              return (
                <div key={n}>
                  <label className="text-sm font-medium block mb-1.5 flex items-center gap-2">
                    Nurse {n}
                    {isNull && (
                      <span className="text-[10px] tracking-wider text-[oklch(0.55_0.17_70)] flex items-center gap-1">
                        <AlertTriangle size={11} /> NEEDS VALUE
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={alloc[n] ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") return setAlloc({ ...alloc, [n]: null });
                        const num = Number(v);
                        if (!Number.isFinite(num) || num < 0) {
                          toast.error("Negative values are not allowed");
                          return;
                        }
                        setAlloc({ ...alloc, [n]: num });
                      }}
                      className={`flex-1 px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] ${isNull ? "border-[oklch(0.78_0.17_85)] bg-[oklch(0.99_0.04_85)]" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setAlloc({ ...alloc, [n]: 0 })}
                      className="text-xs border px-2 py-2 rounded-md hover:bg-secondary"
                      title="Set to 0"
                    >
                      Set 0
                    </button>
                    <span className="text-sm text-muted-foreground w-10">units</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`mt-4 p-3 rounded-md text-sm ${over ? "bg-[oklch(0.95_0.08_25)] text-[oklch(0.45_0.2_25)]" : "bg-[oklch(0.96_0.04_245)] text-[oklch(0.4_0.12_245)]"}`}>
            Total distributed: {total} / {med.units} available
          </div>

          <button
            onClick={save}
            disabled={over || missing.length > 0}
            className="mt-4 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            Save Distribution
          </button>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-5 border-b">
            <h3 className="font-semibold">Current Allocations</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Saved distribution records — these deduct from Stock Levels.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="px-5 py-3 font-medium">Medication</th>
                  {nurses.map((n) => <th key={n} className="px-5 py-3 font-medium">{n}</th>)}
                  <th className="px-5 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {allocationsForDisplay.map((a) => {
                  const t = nurses.reduce((s, n) => s + (a.nurses[n] ?? 0), 0);
                  return (
                    <tr key={a.med} className="border-t">
                      <td className="px-5 py-3.5">{a.med}</td>
                      {nurses.map((n) => <td key={n} className="px-5 py-3.5">{a.nurses[n] ?? 0}</td>)}
                      <td className="px-5 py-3.5 font-semibold">{t}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
