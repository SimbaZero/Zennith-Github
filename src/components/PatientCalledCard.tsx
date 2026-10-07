import { useEffect, useState } from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { QueueEntry } from "@/lib/clinic-data";

// Lazily loaded, the same way the reception routes do it — clinic-data is a
// large module and the patient pages shouldn't carry it in their first bundle
// just in case this card has something to show.
let clinicData: typeof import("@/lib/clinic-data") | null = null;
async function getClinicData() {
  if (!clinicData) clinicData = await import("@/lib/clinic-data");
  return clinicData;
}

/**
 * "You've been called" with a single "I'm on my way" button.
 *
 * Acknowledging is NOT arriving: it writes patientAcknowledgedAt and nothing
 * else. Only staff move a patient to in-room, exactly as before — see
 * acknowledgeCalled in clinic-data.ts and the queue rule in firestore.rules.
 *
 * The card stays on screen once tapped, in a confirmed state, rather than
 * vanishing. The patient is most likely walking across a yard holding their
 * phone, and something that disappears the moment it's used leaves them
 * wondering whether it registered.
 */
export function PatientCalledCard({
  patientId,
}: {
  patientId?: string | null;
}) {
  const [entry, setEntry] = useState<QueueEntry | null>(null);
  const [sending, setSending] = useState(false);
  // patientAcknowledgedAt is a serverTimestamp, so the snapshot raised
  // locally right after the tap still reads null for it. Without this the
  // card would flip back to "You've been called" for a moment.
  const [justAcknowledged, setJustAcknowledged] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setEntry(null);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    getClinicData().then(({ subscribePatientQueueEntry }) => {
      if (cancelled) return;
      unsubscribe = subscribePatientQueueEntry(
        patientId,
        (next) => setEntry(next),
        (err) => console.error("Own queue entry subscription failed:", err),
      );
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [patientId]);

  const entryId = entry?.id;
  useEffect(() => {
    setJustAcknowledged(false);
  }, [entryId]);

  if (!entry || entry.status !== "called") return null;

  const acknowledged = justAcknowledged || entry.patientAcknowledgedAt != null;
  const destination = entry.clinician ?? "the consulting room";
  const calledAtLabel = entry.calledAt
    ? new Date(entry.calledAt).toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const acknowledge = async () => {
    setSending(true);
    try {
      const { acknowledgeCalled } = await getClinicData();
      await acknowledgeCalled(entry.id);
      setJustAcknowledged(true);
    } catch (err) {
      // acknowledgeCalled refuses when offline, and its message explains that
      // nothing was saved — better than a generic line here.
      toast.error(
        err instanceof Error ? err.message : "Could not send that — try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      aria-live="polite"
      className={`mb-6 rounded-xl border p-5 ${
        acknowledged
          ? "border-[oklch(0.8_0.1_160)] bg-[oklch(0.97_0.04_160)]"
          : "border-[oklch(0.75_0.12_245)] bg-[oklch(0.97_0.05_245)]"
      }`}
    >
      <div className="flex items-start gap-3">
        {acknowledged ? (
          <CheckCircle2
            size={24}
            className="shrink-0 text-[oklch(0.5_0.14_160)]"
          />
        ) : (
          <BellRing size={24} className="shrink-0 text-[oklch(0.5_0.18_245)]" />
        )}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">
            {acknowledged
              ? "Reception knows you're on your way"
              : `You've been called — ${destination}`}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {acknowledged
              ? `Please make your way to ${destination}. Staff will take it from here — you don't need to do anything else on your phone.`
              : `Please make your way to ${destination}.`}
            {calledAtLabel ? ` Called at ${calledAtLabel}.` : ""}
          </p>
        </div>
      </div>

      {!acknowledged && (
        <button
          onClick={acknowledge}
          disabled={sending}
          className="mt-4 w-full sm:w-auto min-h-[48px] px-6 rounded-lg bg-[oklch(0.55_0.18_245)] text-white text-base font-medium hover:bg-[oklch(0.49_0.18_245)] disabled:opacity-60"
        >
          {sending ? "Sending…" : "I'm on my way"}
        </button>
      )}
    </div>
  );
}
