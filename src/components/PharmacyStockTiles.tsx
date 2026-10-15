import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Loading } from "@/components/Loading";
import type { StockItem } from "@/lib/pharmacist-service";
import { groupStockByMedicine, type StockTone } from "@/lib/stock-groups";

// ---------------------------------------------------------------------------
// "What the pharmacy has right now" - a quick coloured overview sitting above
// the send / receive forms, so the pharmacist sees what is on the shelf before
// deciding what to send. These are the SAME stock lines the forms below use, so
// the numbers can't disagree with them.
//
// The same medicine is stocked as a separate line per clinic, so lines are
// folded into ONE card per medicine showing the total; tapping a card shows the
// individual lines. A card's colour follows the medicine's total against its
// lines' combined reorder levels:
//   red    = out of stock            -> order from your supplier now
//   amber  = at or below reorder level -> order from your supplier soon
//   green  = fine
// A clinic's own stock is a separate thing (see Stock Levels).
// ---------------------------------------------------------------------------
const TONE_STYLE: Record<StockTone, { box: string; num: string; tag: string }> =
  {
    out: {
      box: "bg-red-50 border-red-200",
      num: "text-red-700",
      tag: "Out of stock — order now",
    },
    low: {
      box: "bg-amber-50 border-amber-200",
      num: "text-amber-700",
      tag: "Low — order from supplier",
    },
    ok: {
      box: "bg-emerald-50 border-emerald-200",
      num: "text-emerald-700",
      tag: "OK",
    },
  };

export function PharmacyStockTiles({
  stock,
  loading,
  unavailable,
  clinicNames,
}: {
  stock: StockItem[];
  loading: boolean;
  /** The live stock feed fell back to demo data: there is no real stock to show. */
  unavailable: boolean;
  /** Names for the clinics this pharmacist knows; others are shown by number. */
  clinicNames: Map<number, string>;
}) {
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const allGroups = useMemo(
    () => groupStockByMedicine(stock, clinicNames),
    [stock, clinicNames],
  );
  const needOrder = allGroups.filter((g) => g.tone !== "ok").length;
  const term = search.trim().toLowerCase();
  const groups = term
    ? allGroups.filter((g) => g.name.toLowerCase().includes(term))
    : allGroups;
  // Distinct names for the browser's built-in autocomplete list.
  const names = allGroups.map((g) => g.name).sort();
  const openGroup = groups.find((g) => g.key === openKey) ?? null;

  return (
    <div className="bg-white rounded-xl border p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold">In your pharmacy right now</h3>
          <p className="text-xs text-muted-foreground">
            One card per medicine, with its total. Tap a card to see how much
            each clinic holds. Red and amber need ordering from your supplier.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {needOrder === 0
            ? "Nothing to order"
            : `${needOrder} to order from supplier`}
        </span>
      </div>
      <div className="mb-3">
        <input
          type="search"
          list="pharmacy-stock-names"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a medication, e.g. Metformin"
          aria-label="Search pharmacy stock"
          className="w-full sm:max-w-xs border rounded-md px-3 py-2 text-sm"
        />
        <datalist id="pharmacy-stock-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      {allGroups.length === 0 ? (
        // This used to say "Loading stock…" whatever the reason it was empty,
        // so a stock feed that had failed looked like it was still on its way.
        <p className="text-sm text-muted-foreground">
          {unavailable ? (
            "Live stock can't be loaded, so there is nothing to show."
          ) : loading ? (
            <Loading label="Loading stock" />
          ) : (
            "No stock is recorded at the pharmacy yet."
          )}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No medication matches "{search.trim()}".
        </p>
      ) : (
        <>
          {/* One row of cards, scrolled sideways, so the list doesn't grow
              downwards however many medicines there are. */}
          <div
            className="flex gap-3 overflow-x-auto pb-2 snap-x"
            data-testid="stock-groups"
            role="list"
          >
            {groups.map((g) => {
              const t = TONE_STYLE[g.tone];
              const open = openKey === g.key;
              return (
                <div
                  key={g.key}
                  role="listitem"
                  data-testid="stock-group"
                  className={`w-44 shrink-0 snap-start rounded-lg border ${t.box} ${
                    open ? "ring-2 ring-[oklch(0.55_0.18_245)]" : ""
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : g.key)}
                    className="w-full p-3 text-left"
                  >
                    <span className="flex items-start gap-1">
                      <span className="text-xs font-medium leading-tight flex-1 truncate">
                        {g.name}
                      </span>
                      <ChevronDown
                        size={14}
                        aria-hidden
                        className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </span>
                    <span className={`block text-2xl font-bold mt-1 ${t.num}`}>
                      {g.totalUnits.toLocaleString()}
                    </span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      {t.tag}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {g.lines.length} clinic{g.lines.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {openGroup && (
            <div
              className="mt-3 rounded-lg border bg-secondary/30"
              data-testid="stock-group-detail"
            >
              <p className="border-b px-3 py-2 text-xs font-medium">
                {openGroup.name} — {openGroup.totalUnits.toLocaleString()} units
                across {openGroup.lines.length} clinic
                {openGroup.lines.length === 1 ? "" : "s"}
              </p>
              <ul className="divide-y" data-testid="stock-group-lines">
                {openGroup.lines.map((l) => (
                  <li
                    key={l.item.docId ?? l.label}
                    className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                  >
                    {/* The clinic's own name, so it's plain whose stock this
                        is. Plain numbers: only the card's total is coloured. */}
                    <span className="font-medium">{l.label}</span>
                    <span>
                      <strong>{l.item.units.toLocaleString()}</strong> units
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
