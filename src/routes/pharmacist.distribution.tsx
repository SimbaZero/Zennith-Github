import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  useInventory,
  addInventoryStock,
  getNursesForClinic,
  recordDistribution,
  useRecentDistributions,
  type Nurse,
} from "@/lib/pharmacist-service";
import { useActiveClinic } from "@/lib/clinic";
import { toast } from "sonner";
import { AlertTriangle, Plus, Send, Users } from "lucide-react";

export const Route = createFileRoute("/pharmacist/distribution")({
  component: Distribution,
});

// ---------------------------------------------------------------------------
// Receive Stock from Supplier — writes real Firestore inventory updates.
// ---------------------------------------------------------------------------
function SupplierIntake({
  stock,
}: {
  stock: ReturnType<typeof useInventory>["stock"];
}) {
  const [medIdx, setMedIdx] = useState(0);
  const [qty, setQty] = useState<string>("");
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);

  const med = stock[medIdx];
  if (!med) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      return toast.error("Enter a positive quantity to add");
    }
    if (!med.docId) {
      return toast.error(
        "This medication isn't linked to a real inventory record.",
      );
    }

    setSaving(true);
    try {
      await addInventoryStock(med.docId, n);
      toast.success(
        `Added ${n} units of ${med.name}${supplier ? ` from ${supplier}` : ""} — saved to database`,
      );
      setQty("");
      setSupplier("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update stock in the database. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Plus size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Receive Stock from Supplier</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Log incoming stock — this writes directly to the real Firestore
        inventory record.
      </p>
      <form
        onSubmit={submit}
        className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_auto] gap-3 items-end"
      >
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
            Medication
          </label>
          <select
            value={medIdx}
            onChange={(e) => setMedIdx(Number(e.target.value))}
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
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
            Quantity to add
          </label>
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
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
            Supplier (optional)
          </label>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="e.g. Adcock Ingram"
            className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2.5 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60 flex items-center gap-1.5"
        >
          <Plus size={14} /> {saving ? "Saving..." : "Add to stock"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribute to Nurses — real nurses (looked up by clinic), real Firestore
// writes to `distributions`, and a real inventory deduction.
// ---------------------------------------------------------------------------
function NurseDistribution({
  stock,
}: {
  stock: ReturnType<typeof useInventory>["stock"];
}) {
  const clinic = useActiveClinic();
  const [medIdx, setMedIdx] = useState(0);
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [nursesLoading, setNursesLoading] = useState(true);
  const [alloc, setAlloc] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);

  const med = stock[medIdx];

  // Load the real nurses for the currently active clinic whenever it changes.
  useEffect(() => {
    setNursesLoading(true);
    getNursesForClinic(clinic.name)
      .then((list) => {
        setNurses(list);
        setAlloc(Object.fromEntries(list.map((n) => [n.nurseId, null])));
      })
      .catch((err) => {
        console.error("Failed to load nurses:", err);
        toast.error("Couldn't load nurses for this clinic.");
        setNurses([]);
      })
      .finally(() => setNursesLoading(false));
  }, [clinic.name]);

  if (!med) return null;

  const total = nurses.reduce((s, n) => s + (alloc[n.nurseId] ?? 0), 0);
  const over = total > med.units;
  const missing = nurses.filter((n) => alloc[n.nurseId] === null);

  const save = async () => {
    if (!med.docId)
      return toast.error(
        "This medication isn't linked to a real inventory record.",
      );
    if (over) return toast.error("Total exceeds available stock");
    if (missing.length > 0) {
      return toast.error(
        `Cannot save — ${missing.map((n) => n.nurseId).join(", ")} ${missing.length === 1 ? "has" : "have"} no value. Enter 0 if none.`,
      );
    }
    if (total === 0)
      return toast.error("Enter at least one nurse allocation greater than 0");

    setSaving(true);
    try {
      // Write one real distribution record per nurse that received a non-zero amount.
      const toGive = nurses.filter((n) => (alloc[n.nurseId] ?? 0) > 0);
      for (const nurse of toGive) {
        await recordDistribution({
          inventoryDocId: med.docId!,
          medName: med.name,
          nurseId: nurse.nurseId,
          unitsGiven: alloc[nurse.nurseId]!,
        });
      }
      toast.success(
        `Distribution saved · ${total} units recorded to the database`,
      );
      setAlloc(Object.fromEntries(nurses.map((n) => [n.nurseId, null])));
    } catch (err) {
      console.error(err);
      toast.error("Failed to save distribution. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Users size={16} className="text-[oklch(0.55_0.18_245)]" />
        <h3 className="font-semibold">Distribute Stock to Nurses</h3>
      </div>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Assign medication quantities to real nurses at{" "}
        <strong>{clinic.name}</strong>. Saves directly to the database and
        deducts from central inventory.
      </p>

      <label className="text-sm font-medium block mb-1.5">Medication</label>
      <select
        value={medIdx}
        onChange={(e) => setMedIdx(Number(e.target.value))}
        className="w-full px-3 py-2.5 border rounded-md mb-4 outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
      >
        {stock.map((s, i) => (
          <option key={s.docId ?? s.name} value={i}>
            {s.name} ({s.units} available)
          </option>
        ))}
      </select>

      {nursesLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading nurses for this clinic...
        </p>
      ) : nurses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No nurses found for {clinic.name} in the database.
        </p>
      ) : (
        <div className="space-y-3">
          {nurses.map((n) => {
            const isNull = alloc[n.nurseId] === null;
            return (
              <div key={n.nurseId}>
                <label className="text-sm font-medium block mb-1.5 flex items-center gap-2">
                  {n.nurseId}{" "}
                  {n.specialisation && (
                    <span className="text-muted-foreground font-normal">
                      ({n.specialisation})
                    </span>
                  )}
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
                    value={alloc[n.nurseId] ?? ""}
                    placeholder="—"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "")
                        return setAlloc({ ...alloc, [n.nurseId]: null });
                      const num = Number(v);
                      if (!Number.isFinite(num) || num < 0) {
                        toast.error("Negative values are not allowed");
                        return;
                      }
                      setAlloc({ ...alloc, [n.nurseId]: num });
                    }}
                    className={`flex-1 px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] ${isNull ? "border-[oklch(0.78_0.17_85)] bg-[oklch(0.99_0.04_85)]" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={() => setAlloc({ ...alloc, [n.nurseId]: 0 })}
                    className="text-xs border px-2 py-2 rounded-md hover:bg-secondary"
                    title="Set to 0"
                  >
                    Set 0
                  </button>
                  <span className="text-sm text-muted-foreground w-10">
                    units
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`mt-4 p-3 rounded-md text-sm ${over ? "bg-[oklch(0.95_0.08_25)] text-[oklch(0.45_0.2_25)]" : "bg-[oklch(0.96_0.04_245)] text-[oklch(0.4_0.12_245)]"}`}
      >
        Total distributed: {total} / {med.units} available
      </div>

      <button
        onClick={save}
        disabled={over || missing.length > 0 || saving || nurses.length === 0}
        className="mt-4 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60 flex items-center gap-1.5"
      >
        <Send size={14} /> {saving ? "Saving..." : "Save Distribution"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent Distributions — live-reads real records from Firestore.
// ---------------------------------------------------------------------------
function RecentDistributions() {
  const records = useRecentDistributions(20);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="p-5 border-b">
        <h3 className="font-semibold">Recent Distributions</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Live from the database — most recent first.
        </p>
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
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-6 text-center text-muted-foreground"
                >
                  No distributions recorded yet.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.docId} className="border-t">
                  <td className="px-5 py-3.5">{r.medName}</td>
                  <td className="px-5 py-3.5">{r.nurseName}</td>
                  <td className="px-5 py-3.5 font-semibold">{r.unitsGiven}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {r.date}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Distribution() {
  const { stock } = useInventory();

  return (
    <AppShell role="pharmacist" title="Stock Distribution">
      <div className="space-y-6">
        <SupplierIntake stock={stock} />
        <NurseDistribution stock={stock} />
        <RecentDistributions />
      </div>
    </AppShell>
  );
}
