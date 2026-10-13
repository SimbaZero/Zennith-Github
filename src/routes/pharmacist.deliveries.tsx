import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { StockFallbackBanner } from "@/components/StockFallbackBanner";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Truck } from "lucide-react";
import {
  useInventory,
  useCurrentPharmacist,
  useStockDeliveries,
  useSupplierOrders,
  useClinicForecasts,
  useOpenReorders,
  reorderSuggestions,
  type StockDelivery,
} from "@/lib/pharmacist-service";
import { SuggestedReorders } from "@/components/QuickReorder";
import { ClinicDeliverySuggestions } from "@/components/ClinicDeliverySuggestions";
import { ManualSupplierOrder } from "@/components/ManualSupplierOrder";
import { SendToClinicForm } from "@/components/SendToClinicForm";
import { SupplierDeliveries } from "@/components/SupplierDeliveries";
import { DeliveryHistory } from "@/components/DeliveryHistory";
import { PharmacyStockTiles } from "@/components/PharmacyStockTiles";
import { splitRestock } from "@/lib/stock-groups";
import { buildDeliveryHistory } from "@/lib/delivery-history";
import { getAuth } from "@/lib/auth";
import { useSuggestionAlerts } from "@/lib/suggestion-alerts";
import { useRealActiveClinic } from "@/lib/active-clinic";

export const Route = createFileRoute("/pharmacist/deliveries")({
  component: Deliveries,
});

// The page is laid out as a dashboard of labelled zones, because two different
// things used to read as one:
//
//   ORDER FROM SUPPLIER  supplier -> pharmacy. The pharmacy replenishing itself.
//                        Stock goes up when the delivery is confirmed as arrived.
//   SEND TO CLINIC       pharmacy -> clinic. The pharmacy's own stock going out
//                        to a clinic. Stock leaves the shelf now; the clinic
//                        gains it when a nurse confirms.
//
// and, separately, what the system suggests from low-stock detection versus what
// someone starts by hand. Each of those gets its own zone and its own words.

function Zone({
  id,
  label,
  title,
  description,
  count,
  children,
}: {
  id: string;
  label: string;
  title: string;
  description: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="mb-8 scroll-mt-20">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 border-l-4 border-[oklch(0.55_0.18_245)] pl-3">
        <span className="text-[11px] font-semibold tracking-widest text-[oklch(0.45_0.15_245)]">
          {label}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
        {count && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
        <p className="basis-full text-xs text-muted-foreground">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

/** "Supplier → Pharmacy" / "Pharmacy → Hillbrow": which way the stock is moving. */
function Direction({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-secondary/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {from} <ArrowRight size={11} aria-hidden /> {to}
    </span>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border bg-white px-4 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Deliveries() {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  const { stock, loading: stockLoading, usingFallback } = useInventory();

  // Everything on this page is for whichever clinic is selected in the header —
  // there is no separate destination picker. Having both meant the header could
  // say "Hillbrow" while you sent stock to Tembisa, which was contradictory.
  const targetClinicId = realClinic.activeClinicId ?? null;
  const targetClinicName = realClinic.activeClinicName;
  const clinicLabel = targetClinicName ?? "the clinic";

  const available = useMemo(() => stock.filter((s) => s.docId), [stock]);
  const clinicNames = useMemo(
    () => new Map(realClinic.options.map((o) => [o.clinicId, o.clinicName])),
    [realClinic.options],
  );

  const { deliveries, loading: deliveriesLoading } = useStockDeliveries(
    targetClinicId ?? undefined,
  );
  const { orders } = useSupplierOrders(targetClinicId ?? undefined);
  const { forecasts } = useClinicForecasts(targetClinicId ?? undefined);
  const { openByInventoryDoc, loading: openLoading } = useOpenReorders(
    targetClinicId ?? undefined,
  );

  // The session role decides who may confirm a delivery arrived; the service
  // checks the profile again before any stock moves.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => setRole(getAuth()), []);
  const actor =
    pharmacist?.fullName || pharmacist?.pharmacistId || "pharmacist";

  const sentToClinic = useMemo(
    () => deliveries.filter((d) => d.status === "Pending"),
    [deliveries],
  );

  // SUGGESTED: what low-stock detection finds, split by what would fix it. A
  // medicine the pharmacy's own stock can supply is a "send to clinic"; one
  // nothing can supply is an "order from supplier". Never both for the same one,
  // so the two zones can't read as the same action - and a medicine whose
  // delivery is already on its way is still a "send", not a supplier order.
  const restock = useMemo(
    () =>
      targetClinicId == null
        ? null
        : splitRestock({
            forecasts,
            stock: available,
            clinicId: targetClinicId,
            inTransit: sentToClinic.flatMap((d: StockDelivery) =>
              (d.items ?? []).map((i) => i.name),
            ),
          }),
    [forecasts, available, targetClinicId, sentToClinic],
  );
  const sendSuggestions = useMemo(() => restock?.suggestions ?? [], [restock]);
  const orderForecasts = useMemo(() => {
    const covered = restock?.coveredDocIds ?? new Set<string>();
    return forecasts.filter((f) => !f.docId || !covered.has(f.docId));
  }, [forecasts, restock]);
  const orderSuggestions = reorderSuggestions(
    orderForecasts,
    openByInventoryDoc,
  );

  // Told once when a suggestion appears, and again on a later visit if it is
  // still unresolved - never repeatedly during one stay.
  const where = targetClinicName ?? "the clinic";
  useSuggestionAlerts({
    ready:
      !usingFallback &&
      !stockLoading &&
      !openLoading &&
      targetClinicId != null &&
      !!pharmacist,
    userId: pharmacist?.userId,
    scope: String(targetClinicId),
    groups: [
      {
        kind: "supplier-order",
        items: orderSuggestions.map((f) => ({
          key: f.docId ?? f.name,
          label: f.name,
        })),
        title: "Suggested: order from supplier",
        message: (labels) =>
          `${labels.length === 1 ? "1 medication" : `${labels.length} medications`} at ${where} should be ordered from a supplier: ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ", and more" : ""}.`,
        link: "/pharmacist/deliveries#zone-suggested",
      },
      {
        kind: "clinic-delivery",
        items: sendSuggestions.map((s) => ({
          key: s.forecast.docId ?? s.forecast.name,
          label: s.forecast.name,
        })),
        title: "Suggested: send to clinic",
        message: (labels) =>
          `${where} is low on ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ", and more" : ""} — the pharmacy can restock it.`,
        link: "/pharmacist/deliveries#zone-suggested",
      },
    ],
  });

  const history = useMemo(
    () =>
      buildDeliveryHistory({
        orders,
        deliveries,
        clinicName: targetClinicName,
      }),
    [orders, deliveries, targetClinicName],
  );

  const waitingForSuppliers = orders.filter((o) => o.status === "ordered");

  return (
    <AppShell role="pharmacist" title="Stock Deliveries">
      {/* One clinic context: whatever the header says is where stock goes. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-4 py-2.5">
        <Truck size={15} className="text-muted-foreground shrink-0" />
        <p className="text-sm">
          Working on <strong>{targetClinicName ?? "no clinic selected"}</strong>
        </p>
        <span className="text-xs text-muted-foreground ml-auto">
          Change the clinic in the header to work on another
        </span>
      </div>

      {usingFallback && <StockFallbackBanner className="mb-4" />}

      {/* The dashboard, at a glance. */}
      <nav
        aria-label="Sections"
        className="mb-6 flex flex-wrap gap-2 text-xs"
        data-testid="zone-nav"
      >
        {[
          [
            "#zone-suggested",
            `Suggested (${orderSuggestions.length + sendSuggestions.length})`,
          ],
          ["#zone-manual", "Manual"],
          [
            "#zone-receive",
            `Receive deliveries (${waitingForSuppliers.length})`,
          ],
          ["#zone-sent", `Sent to clinics (${sentToClinic.length})`],
          ["#zone-history", "History"],
        ].map(([href, text]) => (
          <a
            key={href}
            href={href}
            className="rounded-full border bg-white px-3 py-1 hover:bg-secondary"
          >
            {text}
          </a>
        ))}
      </nav>

      <PharmacyStockTiles
        stock={available}
        loading={stockLoading}
        unavailable={usingFallback}
        clinicNames={clinicNames}
      />

      {/* ---- SUGGESTED: the system noticed something is low ---- */}
      <Zone
        id="zone-suggested"
        label="SUGGESTED"
        title="Suggested by the system"
        description="Found by low-stock detection for the selected clinic. Review the amount, then confirm — nothing happens until you do."
        count={`${orderSuggestions.length + sendSuggestions.length} to look at`}
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Order from supplier</h3>
          <Direction from="Supplier" to="Pharmacy" />
        </div>
        {orderSuggestions.length > 0 ? (
          <SuggestedReorders
            forecasts={orderForecasts}
            clinicId={targetClinicId ?? undefined}
            clinicName={targetClinicName}
          />
        ) : (
          <div className="mb-6">
            <EmptyLine>
              Nothing needs ordering from a supplier right now.
            </EmptyLine>
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">Send to clinic</h3>
          <Direction from="Pharmacy" to={clinicLabel} />
        </div>
        {sendSuggestions.length > 0 ? (
          <ClinicDeliverySuggestions
            suggestions={sendSuggestions}
            clinicId={targetClinicId}
            clinicName={targetClinicName}
            pharmacistId={pharmacist?.pharmacistId}
            clinicNames={clinicNames}
          />
        ) : (
          <EmptyLine>
            {clinicLabel} isn't low on anything the pharmacy can supply right
            now.
          </EmptyLine>
        )}
      </Zone>

      {/* ---- MANUAL: started by hand ---- */}
      <Zone
        id="zone-manual"
        label="MANUAL"
        title="Start one yourself"
        description="For anything the system hasn't suggested. These are two different actions — read the heading on each."
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border bg-white p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Order from supplier</h3>
              <Direction from="Supplier" to="Pharmacy" />
            </div>
            <ManualSupplierOrder
              stock={available}
              clinicId={targetClinicId}
              clinicName={targetClinicName}
              forecasts={forecasts}
            />
          </div>
          <div className="rounded-xl border bg-white p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Send to clinic</h3>
              <Direction from="Pharmacy" to={clinicLabel} />
            </div>
            <SendToClinicForm
              available={available}
              clinicId={targetClinicId}
              clinicName={targetClinicName}
              pharmacistId={pharmacist?.pharmacistId}
            />
          </div>
        </div>
      </Zone>

      {/* ---- RECEIVE: what is on its way TO the pharmacy ---- */}
      <Zone
        id="zone-receive"
        label="RECEIVE DELIVERIES"
        title="Deliveries arriving at the pharmacy"
        description="Orders placed with a supplier. Count what arrived and confirm it here; that is the only way pharmacy stock goes up."
        count={`${waitingForSuppliers.length} on the way`}
      >
        <SupplierDeliveries
          orders={orders}
          stock={available}
          actor={actor}
          role={role}
        />
      </Zone>

      {/* ---- SENT: what is on its way FROM the pharmacy ---- */}
      <Zone
        id="zone-sent"
        label="SENT TO CLINICS"
        title={`On its way to ${clinicLabel}`}
        description="Stock the pharmacy has sent out. It stays here until a nurse at the clinic confirms it arrived."
        count={`${sentToClinic.length} on the way`}
      >
        {sentToClinic.length === 0 ? (
          <EmptyLine>Nothing is on its way to {clinicLabel}.</EmptyLine>
        ) : (
          <ul className="space-y-2">
            {sentToClinic.map((d) => (
              <PendingDeliveryCard key={d.id} d={d} />
            ))}
          </ul>
        )}
      </Zone>

      {/* ---- HISTORY: completed, tucked away ---- */}
      <section id="zone-history" aria-label="History" className="scroll-mt-20">
        <DeliveryHistory rows={history} loading={deliveriesLoading} />
      </section>
    </AppShell>
  );
}

function PendingDeliveryCard({ d }: { d: StockDelivery }) {
  const when = new Date(d.sentAt);
  const validDate = !Number.isNaN(when.getTime());
  // The Firestore document id is long and random, so this shows a short
  // uppercase tail of it: enough to quote on a phone call or search for.
  const ref = String(d.id ?? "")
    .slice(-6)
    .toUpperCase();
  return (
    <li className="rounded-lg border bg-white p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
          #{ref}
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
          In transit
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {validDate
            ? when.toLocaleString("en-ZA", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "date not recorded"}
        </span>
      </div>
      <ul className="text-sm">
        {(d.items ?? []).map((it, i) => (
          <li key={i} className="flex justify-between">
            <span>{it.name}</span>
            <span className="font-medium">{it.quantity}</span>
          </li>
        ))}
      </ul>
      {d.note && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground">
          {d.note}
        </p>
      )}
    </li>
  );
}
