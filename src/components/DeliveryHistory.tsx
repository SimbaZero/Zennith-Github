import { useMemo, useState } from "react";
import { ChevronDown, ClipboardList, Search } from "lucide-react";
import { AuditEventList } from "@/components/AuditEventList";
import { searchHistory, type HistoryRow } from "@/lib/delivery-history";

/** How many of the most recent completed deliveries are shown before searching. */
export const HISTORY_DEFAULT_COUNT = 5;

/**
 * Completed deliveries, hidden until asked for.
 *
 * Built from the pieces the activity log on the reception queue already uses:
 * the same collapsed "View …" toggle, and the same AuditEventList rows (grouped
 * by day, a row opens for its detail). It shows the five most recent; typing in
 * the search box looks through all of them.
 */
export function DeliveryHistory({
  rows,
  loading = false,
}: {
  rows: HistoryRow[];
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState(0);

  const searching = search.trim().length > 0;
  const matches = useMemo(() => searchHistory(rows, search), [rows, search]);
  const shown = searching
    ? matches
    : matches.slice(0, HISTORY_DEFAULT_COUNT + extra);
  const hidden = searching ? 0 : matches.length - shown.length;

  return (
    <div className="mt-4 pt-4 border-t" data-testid="delivery-history">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full min-h-[40px] flex items-center gap-2 text-left"
      >
        <ClipboardList size={14} className="text-muted-foreground" />
        <span className="text-sm font-medium">
          {open ? "Hide delivery history" : "View delivery history"}
        </span>
        <span className="text-xs text-muted-foreground">
          {rows.length} completed
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2 border rounded-lg overflow-hidden">
          <div className="relative border-b p-2">
            <Search
              size={14}
              aria-hidden
              className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setExtra(0);
              }}
              placeholder="Search by medicine, supplier or person…"
              aria-label="Search delivery history"
              className="w-full rounded-md border py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          {loading ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <AuditEventList
                rows={shown}
                tone="staff"
                empty={
                  searching
                    ? `No completed delivery matches "${search.trim()}".`
                    : "No completed deliveries yet."
                }
              />
            </div>
          )}
          {!searching && (hidden > 0 || extra > 0) && (
            <div className="flex gap-2 border-t p-2">
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setExtra((n) => n + 10)}
                  className="flex-1 rounded-md border py-1.5 text-xs hover:bg-secondary"
                >
                  Show more ({hidden} older)
                </button>
              )}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={() => setExtra(0)}
                  className="flex-1 rounded-md border py-1.5 text-xs hover:bg-secondary"
                >
                  Show only the latest {HISTORY_DEFAULT_COUNT}
                </button>
              )}
            </div>
          )}
          {searching && (
            <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              {matches.length} of {rows.length} completed deliveries match.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
