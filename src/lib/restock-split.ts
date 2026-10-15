import { useMemo } from "react";
import { useInventory, type MedForecast } from "@/lib/pharmacist-service";
import {
  splitRestock,
  type ClinicDeliverySuggestion,
} from "@/lib/stock-groups";

/**
 * For a clinic's low medicines, which ones the pharmacy's own stock could cover
 * (those are "send to clinic") and which nothing here can supply (those are
 * "order from supplier"). The Deliveries, Stock and Medication Overview pages
 * all ask this, so they never offer both actions for the same medicine.
 *
 * `inTransit` is the names of medicines that already have a delivery on its way
 * to the clinic: those aren't suggested again, but they stay "covered" so they
 * don't turn up as a supplier order either.
 */
export function useRestockSplit(
  forecasts: MedForecast[],
  clinicId: number | undefined,
  inTransit: string[] = [],
): {
  /** Low medicines that can be sent to the clinic from other stock. */
  sendToClinic: ClinicDeliverySuggestion[];
  /** Inventory document ids of every low medicine the pharmacy can cover. */
  sendDocIds: Set<string>;
  /** Those among them whose delivery is already on its way. */
  inTransitDocIds: Set<string>;
} {
  const { stock } = useInventory();
  const transitKey = inTransit.join("\u0000");
  return useMemo(() => {
    if (clinicId == null) {
      return {
        sendToClinic: [],
        sendDocIds: new Set<string>(),
        inTransitDocIds: new Set<string>(),
      };
    }
    const split = splitRestock({
      forecasts,
      stock,
      clinicId,
      inTransit: transitKey ? transitKey.split("\u0000") : [],
    });
    return {
      sendToClinic: split.suggestions,
      sendDocIds: split.coveredDocIds,
      inTransitDocIds: split.inTransitDocIds,
    };
  }, [forecasts, stock, clinicId, transitKey]);
}
