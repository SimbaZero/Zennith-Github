import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  usePatientDirectory,
  getPrescriptionForPatient,
  type PatientDirectoryEntry,
} from "@/lib/pharmacist-service";
import { Search, ShieldCheck, Info } from "lucide-react";

export const Route = createFileRoute("/pharmacist/diagnostics")({
  component: PrescriptionLookup,
});

function PrescriptionLookup() {
  const { patients, loading } = usePatientDirectory();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<PatientDirectoryEntry | null>(null);
  const [prescription, setPrescription] = useState<string | null>(null);
  const [prescriptionLoading, setPrescriptionLoading] = useState(false);

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
    <AppShell role="pharmacist" title="Prescription Lookup">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} className="text-[oklch(0.55_0.18_245)]" />
            <h3 className="font-semibold">Verify a patient prescription</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Search by patient name or ID. Clinical history is not displayed —
            only the current prescription needed to dispense.
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
                  }}
                  className="text-xs border px-2 py-1 rounded-md hover:bg-white"
                >
                  New search
                </button>
              </div>
              <div className="mt-4 pt-4 border-t">
                <p className="text-[11px] tracking-wider text-muted-foreground">
                  PRESCRIPTION TO DISPENSE
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
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
