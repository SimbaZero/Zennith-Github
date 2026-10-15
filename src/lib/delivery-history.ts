import type { StockDelivery, SupplierOrder } from "@/lib/pharmacist-service";

// Completed deliveries, in one list: stock that arrived from a supplier, and
// stock that was sent on to a clinic. Written as plain sentences in the same row
// shape the audit lists use, so the Deliveries page can show them with the same
// component and the same expand-for-detail behaviour as an activity log.

export interface HistoryRow {
  id: string;
  when: string;
  /** One plain sentence. */
  text: string;
  /** Extra lines, shown when the row is opened. */
  detail: string[];
  emphasis?: "critical" | "warn";
}

const day = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : "an unrecorded date";
};

const items = (d: StockDelivery) =>
  (d.items ?? []).map((i) => `${i.name} × ${i.quantity}`).join(", ");

/** Completed deliveries, newest first. Anything still on its way is not history. */
export function buildDeliveryHistory(input: {
  orders: SupplierOrder[];
  deliveries: StockDelivery[];
  /** Name of the clinic the deliveries went to. */
  clinicName?: string;
}): HistoryRow[] {
  const rows: HistoryRow[] = [];

  for (const o of input.orders) {
    if (o.status !== "received") continue;
    const got = o.receivedQty ?? 0;
    const short = got < o.orderedQty;
    const detail = [
      `Confirmed by ${o.receivedBy ?? "someone"}${o.receivedByRole ? ` (${o.receivedByRole})` : ""}`,
      `Ordered ${o.orderedQty} on ${day(o.orderedAt)}${o.orderedBy ? ` by ${o.orderedBy}` : ""}`,
    ];
    if (o.hasDiscrepancy) {
      detail.push(
        `${short ? "Short by" : "Over by"} ${Math.abs(o.orderedQty - got)}${o.discrepancyNote ? ` — “${o.discrepancyNote}”` : ""}`,
      );
    }
    rows.push({
      id: `order-${o.docId}`,
      when: o.receivedAt ?? o.orderedAt,
      text: `Received ${got} × ${o.medName}${o.supplier ? ` from ${o.supplier}` : ""}${
        o.hasDiscrepancy ? ` (${o.orderedQty} ordered)` : ""
      }`,
      detail,
      emphasis: o.hasDiscrepancy ? "warn" : undefined,
    });
  }

  const to = input.clinicName ?? "the clinic";
  for (const d of input.deliveries) {
    if (d.status === "Pending") continue;
    const when = d.confirmedAt ?? d.sentAt;
    const detail = [
      `Sent ${day(d.sentAt)}${d.sentByPharmacistId ? ` by ${d.sentByPharmacistId}` : ""}`,
    ];
    if (d.confirmedByNurseId) {
      detail.push(
        `${d.status === "Confirmed" ? "Received" : "Rejected"} by ${d.confirmedByNurseId}`,
      );
    }
    if (d.note) detail.push(`Note: ${d.note}`);
    if (d.hasDiscrepancy) {
      for (const x of d.discrepancies ?? []) {
        detail.push(`${x.name}: sent ${x.sent}, received ${x.received}`);
      }
      if (d.discrepancyNote) detail.push(`“${d.discrepancyNote}”`);
    }
    if (d.rejectionReason) detail.push(`Rejected: ${d.rejectionReason}`);
    rows.push({
      id: `delivery-${d.id}`,
      when,
      text:
        d.status === "Confirmed"
          ? `Delivery to ${to} confirmed — ${items(d)}`
          : `Delivery to ${to} rejected — ${items(d)}`,
      detail,
      emphasis:
        d.status === "Rejected"
          ? "critical"
          : d.hasDiscrepancy
            ? "warn"
            : undefined,
    });
  }

  return rows.sort((a, b) => b.when.localeCompare(a.when));
}

/** Rows whose sentence or detail mention the search text; an empty search matches all. */
export function searchHistory(
  rows: HistoryRow[],
  search: string,
): HistoryRow[] {
  const term = search.trim().toLowerCase().replace(/^#/, "");
  if (!term) return rows;
  return rows.filter((r) =>
    [r.text, ...r.detail, r.id].some((s) => s.toLowerCase().includes(term)),
  );
}
