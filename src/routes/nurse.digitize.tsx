import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FileText, ScanLine } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/nurse/digitize")({ component: Digitize });

function Digitize() {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(true);

  const startScan = () => {
    setScanning(true);
    setScanned(false);
    setTimeout(() => {
      setScanning(false);
      setScanned(true);
    }, 1500);
  };

  return (
    <AppShell role="nurse" title="Digitize Patient Files">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-1">Scan Patient File</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Use OCR to extract patient data from physical files. Fields with confidence below 85% are flagged for review.
          </p>
          <div className="border-2 border-dashed rounded-lg aspect-[4/3] flex flex-col items-center justify-center bg-secondary/30 mb-4">
            <FileText size={48} className={`text-muted-foreground/50 ${scanning ? "animate-pulse" : ""}`} />
            <p className="text-sm text-muted-foreground mt-3">
              {scanning ? "Scanning..." : "Position patient file in camera view"}
            </p>
          </div>
          <button
            onClick={startScan}
            disabled={scanning}
            className="flex items-center gap-2 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            <ScanLine size={15} /> Start Scan
          </button>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">Extracted Data {scanned && <span className="text-sm font-normal text-muted-foreground">(92% confidence)</span>}</h3>
          {scanned ? (
            <div className="space-y-3 text-sm">
              <DataField label="Full Name" value="Lindiwe Mahlangu" />
              <div className="grid grid-cols-2 gap-3">
                <DataField label="ID Number" value="9103145678082" />
                <DataField label="Date of Birth" value="1991-03-14" />
              </div>
              <DataField label="Cellphone" value="082 123 4567" />
              <DataField label="Diagnosis" value="HIV/AIDS" />
              <DataField label="Current Medication" value="TLD" />
              <DataField label="Notes" value="Started treatment Mar 2024. Viral load undetectable. Next visit Apr 2026." />
              <div className="flex gap-2 pt-2">
                <button className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]">
                  Save to Database
                </button>
                <button onClick={() => setScanned(false)} className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data extracted yet. Run a scan to begin.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
