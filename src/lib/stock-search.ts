import { createServerFn } from "@tanstack/react-start";

// The patient "Find a medication" search: the server function the dashboard
// calls. The work happens in src/server/stock-search.ts, loaded inside the
// handler so none of it (or the service-account code it uses) ends up in the
// browser bundle. See that file for why this isn't a direct Firestore read.

export interface StockSearchItem {
  name: string;
  category?: string;
  inStock: boolean;
}

export type StockSearchResult =
  | { ok: true; clinicLinked: boolean; items: StockSearchItem[] }
  | {
      ok: false;
      reason: "not-configured" | "unauthenticated" | "not-eligible";
    };

export const searchMyClinicStock = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string; term: string }) => d)
  .handler(async ({ data }): Promise<StockSearchResult> => {
    const { searchClinicStock } = await import("../server/stock-search");
    return searchClinicStock(data?.idToken, data?.term);
  });
