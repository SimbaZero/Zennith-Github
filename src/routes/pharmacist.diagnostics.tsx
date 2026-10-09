import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { StockFallbackBanner } from "@/components/StockFallbackBanner";
import {
  usePatientDirectory,
  getPrescriptionForPatient,
  dispenseFromPharmacy,
  useInventory,
  type PatientDirectoryEntry,
} from "@/lib/pharmacist-service";
import { useCurrentPharmacist } from "@/lib/pharmacist-service";
import { useRealActiveClinic } from "@/lib/active-clinic";
import { logAction } from "@/lib/audit";
import {
  HANDOVER_AUDIT_ACTION,
  handoverBlockedReason,
  handoverLogText,
} from "@/lib/fast-lane";
import { toast } from "sonner";
import {
  Search,
  ShieldCheck,
  ShieldOff,
  Info,
  PackageCheck,
} from "lucide-react";

export const Route = createFileRoute("/pharmacist/diagnostics")({
  component: FastLaneHandover,
});

function FastLaneHandover() {
  const { patients, loading } = usePatientDirectory();
  const { pharmacist } = useCurrentPharmacist();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PatientDirectoryEntry | null>(null);
  const [prescription, setPrescription] = useState<string | null>(null);
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);
  const [handedOver, setHandedOver] = useState(false);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (query.length < 2) return [];
    return patients
      .filter(
        (p) =>
          p.fullName.toLowerCase().includes(query) ||
          p.patientId.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [query, patients]);

  const selectPatient = async (p: PatientDirectoryEntry) => {
    setSelected(p);
    setPrescription(null);
    setHandedOver(false);
    if (p.medicalRecordNo == null) return;

    setPrescriptionLoading(true);
    try {
      const rx = await getPrescriptionForPatient(p.medicalRecordNo);
      setPrescription(rx);
    } catch (err) {
      console.error("Failed to load prescription:", err);
    } finally {
      setPrescriptionLoading(false);
    }
  };

  return (
    <AppShell role="pharmacist" title="Fast Lane Handover">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
            <h3 className="font-semibold">Verify a patient prescription</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Search by patient name or ID. Clinical history is not displayed —
            only the current prescription needed to hand medication over.
          </p>

          {loading && (
            <p className="text-sm text-muted-foreground">
              Loading patient directory...
            </p>
          )}

          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSelected(null);
                setPrescription(null);
              }}
              placeholder="e.g. patient name or Pat-1"
              className="w-full pl-9 pr-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
            />
          </div>

          {query.length > 0 && query.length < 2 && (
            <p className="text-xs text-muted-foreground mt-3">
              Type at least 2 characters…
            </p>
          )}

          {query.length >= 2 && !selected && (
            <ul className="mt-3 divide-y border rounded-md">
              {results.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  No matching patient.
                </li>
              )}
              {results.map((p) => (
                <li key={p.patientId}>
                  <button
                    onClick={() => selectPatient(p)}
                    className="w-full text-left p-3 hover:bg-secondary/50 flex items-center justify-between"
                  >
                    <span className="font-medium text-sm">{p.fullName}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {p.patientId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="mt-5 p-4 border rounded-md bg-secondary/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] tracking-wider text-muted-foreground">
                    PATIENT
                  </p>
                  <p className="font-semibold">{selected.fullName}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {selected.patientId}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelected(null);
                    setPrescription(null);
                    setQ("");
                    setHandedOver(false);
                  }}
                  className="text-xs border px-2 py-1 rounded-md hover:bg-white"
                >
                  New search
                </button>
              </div>
              <div className="mt-4 pt-4 border-t">
                <div
                  className={`flex items-center gap-2 text-sm font-medium mb-3 ${
                    selected.fastLane ? "text-green-700" : "text-amber-800"
                  }`}
                >
                  {selected.fastLane ? (
                    <ShieldCheck size={15} />
                  ) : (
                    <ShieldOff size={15} />
                  )}
                  {selected.fastLane ? "Fast Lane patient" : "Not Fast Lane"}
                </div>

                <p className="text-[11px] tracking-wider text-muted-foreground">
                  MEDICATION TO HAND OVER
                </p>
                <p className="text-lg font-semibold mt-1">
                  {prescriptionLoading
                    ? "Loading..."
                    : (prescription ?? "No prescription on record")}
                </p>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                  <Info size={12} /> Clinical diagnosis is hidden from
                  pharmacist view.
                </p>

                {handoverBlockedReason(selected.fastLane) ? (
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3">
                    {handoverBlockedReason(selected.fastLane)}
                  </p>
                ) : handedOver ? (
                  <p className="text-sm text-green-800 mt-3">
                    Handed over to {selected.patientId}. Pharmacy stock updated.
                  </p>
                ) : (
                  <HandoverPanel
                    patient={selected}
                    prescription={prescription}
                    onDone={() => setHandedOver(true)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// Loosened so "Metformin 850mg" on a prescription still finds "Metformin" in
// stock: lower-case, dose removed, letters only.
function looseName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\d+\s*(mg|ml|g|mcg|iu)\b/g, "")
    .replace(/[^a-z]/g, "");
}

function HandoverPanel({
  patient,
  prescription,
  onDone,
}: {
  patient: PatientDirectoryEntry;
  prescription: string | null;
  onDone: () => void;
}) {
  const { pharmacist } = useCurrentPharmacist();
  const realClinic = useRealActiveClinic(pharmacist?.clinicIds, "pharmacist");
  const { stock, usingFallback } = useInventory();
  const clinicId = realClinic.activeClinicId ?? pharmacist?.clinicId;

  const [docId, setDocId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);

  // Stock lines that match the prescription. The pharmacist picks one when
  // there is more than one, so nothing is deducted from a line by guesswork.
  const matches = useMemo(() => {
    const want = looseName(prescription ?? "");
    if (!want) return [];
    return stock.filter((s) => {
      if (!s.docId) return false;
      const have = looseName(s.name);
      return have && (have.includes(want) || want.includes(have));
    });
  }, [stock, prescription]);

  const chosen =
    matches.find((m) => m.docId === docId) ??
    (matches.length === 1 ? matches[0] : undefined);
  const n = Number(qty);
  const valid =
    !!chosen &&
    Number.isInteger(n) &&
    n > 0 &&
    n <= chosen.units &&
    clinicId != null &&
    !!pharmacist?.pharmacistId;

  if (!prescription) return null;
  // With the live stock feed down there are no stock lines to match, which used
  // to produce the next message — claiming the medication isn't stocked when it
  // is and the feed is simply unavailable.
  if (usingFallback) return <StockFallbackBanner className="mt-3" />;
  if (matches.length === 0) {
    return (
      <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3">
        "{prescription}" isn't in the pharmacy's stock list, so it can't be
        handed over here.
      </p>
    );
  }

  const confirm = async () => {
    if (!chosen?.docId || clinicId == null || !pharmacist?.pharmacistId) return;
    setBusy(true);
    try {
      const actor = pharmacist.fullName || "pharmacist";
      const res = await dispenseFromPharmacy({
        inventoryDocId: chosen.docId,
        patientId: patient.patientId,
        clinicId,
        unitsGiven: n,
        pharmacistId: pharmacist.pharmacistId,
        pharmacistName: actor,
        medicalRecordNo: patient.medicalRecordNo,
      });
      logAction({
        clinicId,
        actor_id: actor,
        action_type: HANDOVER_AUDIT_ACTION,
        description: `${handoverLogText(patient.patientId, res.medName, actor)} Quantity: ${n}.`,
      });
      toast.success(
        `${n} × ${res.medName} handed over to ${patient.patientId} — ${res.remaining} left in pharmacy`,
      );
      onDone();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not complete the handover. Nothing was changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {matches.length > 1 && (
        <div>
          <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
            TAKE FROM
          </label>
          <select
            value={chosen?.docId ?? ""}
            onChange={(e) => setDocId(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="" disabled>
              Choose the stock line…
            </option>
            {matches.map((m) => (
              <option key={m.docId} value={m.docId}>
                {m.name} ({m.units} in pharmacy)
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="text-[11px] tracking-wider text-muted-foreground block mb-1">
          QUANTITY TO HAND OVER
        </label>
        <input
          type="number"
          min={1}
          max={chosen?.units}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="e.g. 30"
          className={`w-full border rounded-md px-3 py-2 text-sm ${
            chosen && n > chosen.units ? "border-red-400 bg-red-50" : ""
          }`}
        />
        {chosen && (
          <p
            className={`text-xs mt-1 ${
              n > chosen.units ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {n > chosen.units
              ? `Only ${chosen.units} in the pharmacy.`
              : `${chosen.units} in the pharmacy now.`}
          </p>
        )}
      </div>
      <button
        onClick={confirm}
        disabled={busy || !valid}
        className="w-full inline-flex items-center justify-center gap-2 bg-[oklch(0.18_0.06_260)] text-white text-sm py-2 rounded-md hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-50"
      >
        <PackageCheck size={15} />
        {busy ? "Handing over…" : "Confirm handover"}
      </button>
    </div>
  );
}
