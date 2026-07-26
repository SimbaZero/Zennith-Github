import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { fetchInventory, fetchRecentDistributions, receiveStock, distributeStock } from "@/lib/clinic-data";
import { nurses } from "@/lib/store";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";

export const Route = createFileRoute("/pharmacist/distribution")({ component: Distribution });

function SupplierIntake() {
  const queryClient = useQueryClient();
  const { data: stock = [] } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const [medIdx, setMedIdx] = useState(0);
  const [qty, setQty] = useState<string>("");
  const [supplier, setSupplier] = useState("");

  const intake = useMutation({
    mutationFn: ({ itemId, units }: { itemId: string; units: number }) => receiveStock(itemId, units),
    onSuccess: (_, { units }) => {
      toast.success(`Added ${units} units of ${stock[medIdx]?.name}${supplier ? ` from ${supplier}` : ""}`);
      setQty("");
      setSupplier("");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: () => toast.error("Could not update stock â€” try again"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    const med = stock[medIdx];
    if (!med) return;
    if (!Number.isFinite(n) || n <= 0) {
      return toast.error("Enter a positive quantity to add");
    }
    intake.mutate({ itemId: med.id, units: n });
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Plus size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Receive Stock from Supplier</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Log incoming stock â€” the selected medication's available quantity will increase.
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
              <option key={s.id} value={i}>{s.name} ({s.units} on hand)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">Quantity to add</label>
          <input
            type="number"
            min={1}
            value={qty}
            placeholder="e.g. 200"
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
          disabled={intake.isPending}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] flex items-center gap-1.5 disabled:opacity-60"
        >
          <Plus size={14} /> {intake.isPending ? "Addingâ€¦" : "Add to stock"}
        </button>
      </form>
    </div>
  );
}

function Distribution() {
  const queryClient = useQueryClient();
  const { data: stock = [], isLoading } = useQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
  const { data: recent = [] } = useQuery({ queryKey: ["distributions"], queryFn: fetchRecentDistributions });
  const [medIdx, setMedIdx] = useState(0);
  // null means "not yet entered" â€” we won't auto-fill 0
  const [alloc, setAlloc] = useState<Record<string, number | null>>(
    Object.fromEntries(nurses.map((n) => [n, null])),
  );

  const med = stock[medIdx];

  // Reset the allocation inputs whenever a different medication is selected.
  useEffect(() => {
    setAlloc(Object.fromEntries(nurses.map((n) => [n, null])));
  }, [medIdx]);

  const total = nurses.reduce((s, n) => s + (alloc[n] ?? 0), 0);
  const over = med ? total > med.units : false;
  const missing = nurses.filter((n) => alloc[n] === null);

  const distribute = useMutation({
    mutationFn: () =>
      distributeStock(
        med!.id,
        Object.fromEntries(nurses.map((n) => [n, alloc[n] ?? 0])),
      ),
    onSuccess: () => {
      toast.success(`Distribution saved Â· ${total} units deducted from stock`);
      setAlloc(Object.fromEntries(nurses.map((n) => [n, null])));
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["distributions"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save distribution"),
  });

  const save = () => {
    if (!med) return;
    if (over) return toast.error("Total exceeds available stock");
    if (missing.length > 0) {
      return toast.error(
        `Cannot save â€” ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no value. Enter 0 if none.`,
      );
    }
    if (total === 0) return toast.error("Nothing to distribute â€” all values are 0");
    distribute.mutate();
  };

  return (
    <AppShell role="pharmacist" title="Stock Distribution">
      <div className="space-y-6">
        <SupplierIntake />
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold">Distribute Stock to Nurses</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-5">Assign medication quantities to nurses. Each nurse must have a value â€” enter <strong>0</strong> if they should receive nothing.</p>

          {isLoading && <p className="text-sm text-muted-foreground">Loading inventoryâ€¦</p>}
          {med && (
            <>
              <label className="text-sm font-medium block mb-1.5">Medication</label>
              <select
                value={medIdx}
                onChange={(e) => setMedIdx(Number(e.target.value))}
                className="w-full px-3 py-2.5 border rounded-md mb-4 outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              >
                {stock.map((s, i) => (
                  <option key={s.id} value={i}>{s.name} ({s.units} available)</option>
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
                          placeholder="â€”"
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
                disabled={over || missing.length > 0 || distribute.isPending}
                className="mt-4 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
              >
                {distribute.isPending ? "Savingâ€¦" : "Save Distribution"}
              </button>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-5 border-b">
            <h3 className="font-semibold">Recent Distributions</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Latest distribution records â€” these deduct from Stock Levels.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="px-5 py-3 font-medium">Medication</th>
                  <th className="px-5 py-3 font-medium">Nurse</th>
                  <th className="px-5 py-3 font-medium">Units</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-5 py-3.5">{r.medName}</td>
                    <td className="px-5 py-3.5">{r.nurseName}</td>
                    <td className="px-5 py-3.5 font-semibold">{r.unitsGiven}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{r.date}</td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">No distribution records yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
