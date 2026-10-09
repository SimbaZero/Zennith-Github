import { useEffect, useRef, useState } from "react";
import { auth } from "@/firebase";
import { searchMyClinicStock, type StockSearchItem } from "@/lib/stock-search";

export const STOCK_SEARCH_MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

export type StockSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; items: StockSearchItem[]; clinicLinked: boolean }
  // `unavailable`: the lookup couldn't be completed (server not configured,
  // offline, signed out). Never a reason to stop the person typing.
  | { status: "unavailable" };

/**
 * Looks up `term` in the signed-in patient's own clinic stock.
 *
 * The result is only ever about the term currently in the box: a slow answer
 * for "par" can't overwrite the answer for "paracetamol", and a failure leaves
 * the input alone - the caller never needs to disable it.
 */
export function useStockSearch(term: string): StockSearchState {
  const [state, setState] = useState<StockSearchState>({ status: "idle" });
  const latest = useRef(0);

  useEffect(() => {
    const t = term.trim();
    const mine = ++latest.current;
    if (t.length < STOCK_SEARCH_MIN_CHARS) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error("not signed in");
        const res = await searchMyClinicStock({ data: { idToken, term: t } });
        if (mine !== latest.current) return;
        setState(
          res.ok
            ? {
                status: "done",
                items: res.items,
                clinicLinked: res.clinicLinked,
              }
            : { status: "unavailable" },
        );
      } catch (err) {
        if (mine !== latest.current) return;
        console.warn("Stock search failed:", err);
        setState({ status: "unavailable" });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  return state;
}
