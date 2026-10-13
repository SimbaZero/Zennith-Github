import { useEffect, useRef, useState } from "react";
import { auth } from "@/firebase";
import { searchMyClinicStock, type StockSearchItem } from "@/lib/stock-search";
import { matchSymptom, type SymptomMatch } from "@/lib/symptom-categories";

export const STOCK_SEARCH_MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

export type StockSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "done";
      items: StockSearchItem[];
      clinicLinked: boolean;
      /** Set when the typed words were read as a symptom (a category match). */
      symptom: SymptomMatch | null;
    }
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
export function useStockSearch(
  term: string,
): StockSearchState & { symptom: SymptomMatch | null } {
  const [state, setState] = useState<StockSearchState>({ status: "idle" });
  const latest = useRef(0);

  useEffect(() => {
    const t = term.trim();
    // A symptom word is read first; if there isn't one this is exactly the
    // ordinary name/category search.
    const symptom = matchSymptom(t);
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
        const res = await searchMyClinicStock({
          data: {
            idToken,
            term: t,
            categories: symptom ? symptom.categories : undefined,
          },
        });
        if (mine !== latest.current) return;
        setState(
          res.ok
            ? {
                status: "done",
                items: res.items,
                clinicLinked: res.clinicLinked,
                symptom,
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

  // Known as soon as it is typed, so the notice doesn't wait on the network.
  return { ...state, symptom: matchSymptom(term.trim()) };
}
