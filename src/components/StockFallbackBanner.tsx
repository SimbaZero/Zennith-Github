// Shown by staff pages when useInventory has fallen back to demo data — it
// couldn't read the real stock (a permissions problem, an expired session, an
// offline first load) and its `usingFallback` flag is set.
//
// The patient-facing search has its own inline version of this (it pauses the
// search). Here it's honest about what staff can actually see: demo rows carry
// no document id, so every page that acts on stock filters them out and shows
// nothing — which, without this, looked like "loading forever" or, worse, like
// the medication isn't stocked.

export function StockFallbackBanner({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}
    >
      <strong className="font-medium">
        Live stock is unavailable right now.
      </strong>{" "}
      The pharmacy's real stock levels can't be loaded, so nothing can be sent
      or handed over until it reconnects. No demo numbers are shown in their
      place.
    </div>
  );
}
