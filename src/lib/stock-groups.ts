import type { MedForecast, StockItem } from "@/lib/pharmacist-service";

// The same medicine is stocked as a separate line for each clinic, so a
// pharmacist looking at "what's on the shelf" used to see "Metformin 500mg"
// three times. This folds those lines into one entry per medicine, with the
// total, and keeps the individual lines so they can be shown on request.

export type StockTone = "out" | "low" | "ok";

export interface StockLine {
  item: StockItem;
  /**
   * Whose stock this line is: the clinic's name ("Hillbrow CHC"), or "Clinic 7"
   * when its name isn't known, or "No clinic recorded". A second line for the
   * same clinic is told apart with "(line 2)".
   */
  label: string;
  tone: StockTone;
}

export interface MedicineGroup {
  /** The medicine's name as displayed (the first line's spelling). */
  name: string;
  /** Lower-cased, trimmed, single-spaced: what lines are grouped on. */
  key: string;
  totalUnits: number;
  tone: StockTone;
  /** Lines at or below their own level, or out - worth a look when expanded. */
  linesNeedingAttention: number;
  lines: StockLine[];
}

/** How a medicine's name is compared: case, spacing and stray whitespace ignored. */
export function medicineKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Case-insensitive "contains" on a medication name; an empty search matches all. */
export function matchesMedicine(name: string, search: string): boolean {
  const term = search.trim().toLowerCase();
  return !term || name.toLowerCase().includes(term);
}

/** One line's state against its own reorder level. */
export function lineTone(units: number, threshold: number): StockTone {
  if (units <= 0) return "out";
  if (threshold > 0 && units <= threshold) return "low";
  return "ok";
}

const RANK: Record<StockTone, number> = { out: 0, low: 1, ok: 2 };

/**
 * Groups stock lines by medicine name. A medicine's own state is judged on its
 * TOTAL against the combined reorder levels of its lines - one clinic being
 * short while the pharmacy holds plenty is not a shortage of the medicine - and
 * the lines that are individually short are counted so the card can say so.
 * Groups come out most urgent first, then alphabetical.
 */
export function groupStockByMedicine(
  stock: StockItem[],
  clinicNames: ReadonlyMap<number, string> = new Map(),
): MedicineGroup[] {
  const byKey = new Map<string, StockItem[]>();
  for (const item of stock) {
    const key = medicineKey(item.name);
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }

  const groups: MedicineGroup[] = [];
  for (const [key, items] of byKey) {
    // A stable order: by clinic, then by document, so a line is in the same
    // place from one visit to the next.
    const ordered = [...items].sort(
      (a, b) =>
        (a.clinicId ?? Number.MAX_SAFE_INTEGER) -
          (b.clinicId ?? Number.MAX_SAFE_INTEGER) ||
        String(a.docId ?? "").localeCompare(String(b.docId ?? "")),
    );
    const seen = new Map<string, number>();
    const lines: StockLine[] = ordered.map((item) => {
      const base =
        item.clinicId != null
          ? (clinicNames.get(item.clinicId) ?? `Clinic ${item.clinicId}`)
          : "No clinic recorded";
      const nth = (seen.get(base) ?? 0) + 1;
      seen.set(base, nth);
      return {
        item,
        label: nth > 1 ? `${base} (line ${nth})` : base,
        tone: lineTone(item.units, item.threshold),
      };
    });
    const totalUnits = ordered.reduce((s, i) => s + i.units, 0);
    const combinedThreshold = ordered.reduce((s, i) => s + i.threshold, 0);
    groups.push({
      name: ordered[0].name,
      key,
      totalUnits,
      tone: lineTone(totalUnits, combinedThreshold),
      linesNeedingAttention: lines.filter((l) => l.tone !== "ok").length,
      lines,
    });
  }
  return groups.sort(
    (a, b) => RANK[a.tone] - RANK[b.tone] || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Suggested deliveries TO a clinic.
//
// The Deliveries page already flags medicines a clinic is running low on (the
// same forecast the "Suggested reorders" use). Where another stock line holds
// that medicine, that is a delivery waiting to be made, so it is offered with a
// quantity worked out for the clinic and capped at what the source can spare.
// ---------------------------------------------------------------------------

/** What a line can give without dropping to its own reorder level. */
function spare(s: StockItem): number {
  return Math.max(0, s.units - Math.max(0, s.threshold));
}

export interface ClinicDeliverySuggestion {
  forecast: MedForecast;
  /** Lines that can supply it (other clinics' lines of the same medicine that have stock to spare), most spare first. */
  sources: StockItem[];
  /** The suggested quantity: what the clinic needs, up to what the best source can spare. */
  suggestedQty: number;
}

/**
 * The medicines a clinic is running low on that can be supplied from another
 * stock line, most urgent first.
 *
 * - "Low" is the forecast's own judgement (Order now / Reorder soon): the same
 *   detection the supplier-reorder suggestions use, not a second definition.
 * - A medicine with a delivery already on its way to the clinic is not offered
 *   again (but is still reported as covered).
 * - A medicine nobody else holds can't be delivered; it needs ordering from a
 *   supplier instead, which the reorder suggestions cover.
 */
export function splitRestock(input: {
  forecasts: MedForecast[];
  /** Every stock line the pharmacist can see. */
  stock: StockItem[];
  /** The clinic the delivery would go to. */
  clinicId: number;
  /** Medicines (any spelling) that already have a delivery on its way there. */
  inTransit?: Iterable<string>;
}): {
  /** Deliveries to offer now. */
  suggestions: ClinicDeliverySuggestion[];
  /**
   * Inventory documents of every low medicine the pharmacy's own stock can cover,
   * INCLUDING ones whose delivery is already on its way. These are "send to
   * clinic" matters, so they must never be offered as "order from supplier".
   */
  coveredDocIds: Set<string>;
  /** The covered ones whose delivery has already been sent. */
  inTransitDocIds: Set<string>;
} {
  const onTheWay = new Set([...(input.inTransit ?? [])].map(medicineKey));
  const suggestions: ClinicDeliverySuggestion[] = [];
  const coveredDocIds = new Set<string>();
  const inTransitDocIds = new Set<string>();
  for (const f of input.forecasts) {
    if (f.status !== "critical" && f.status !== "reorder") continue;
    if (!f.docId || !(f.suggestedOrder > 0)) continue;
    const key = medicineKey(f.name);
    const sources = input.stock
      .filter(
        (s) =>
          !!s.docId &&
          s.docId !== f.docId &&
          s.clinicId != null &&
          s.clinicId !== input.clinicId &&
          // A line that is itself at or below its own reorder level has
          // nothing to spare: sending from it would just move the shortage.
          s.units > Math.max(0, s.threshold) &&
          medicineKey(s.name) === key,
      )
      .sort((a, b) => spare(b) - spare(a));
    if (sources.length === 0) continue;
    coveredDocIds.add(f.docId);
    if (onTheWay.has(key)) {
      inTransitDocIds.add(f.docId);
      continue;
    }
    suggestions.push({
      forecast: f,
      sources,
      suggestedQty: Math.min(f.suggestedOrder, spare(sources[0])),
    });
  }
  return { suggestions, coveredDocIds, inTransitDocIds };
}

/** The deliveries to offer. See splitRestock. */
export function suggestClinicDeliveries(input: {
  forecasts: MedForecast[];
  stock: StockItem[];
  clinicId: number;
  inTransit?: Iterable<string>;
}): ClinicDeliverySuggestion[] {
  return splitRestock(input).suggestions;
}

/**
 * The stock line a manual supplier order for `medName` attaches to: the selected
 * clinic's own line if it has one, otherwise the best-stocked line of that
 * medicine. Undefined when no line carries it (nothing to attach an order to).
 */
export function pickOrderLine(
  stock: StockItem[],
  medName: string,
  clinicId: number | null,
): StockItem | undefined {
  const key = medicineKey(medName);
  const lines = stock.filter((s) => !!s.docId && medicineKey(s.name) === key);
  return (
    lines.find((l) => clinicId != null && l.clinicId === clinicId) ??
    [...lines].sort((a, b) => b.units - a.units)[0]
  );
}
