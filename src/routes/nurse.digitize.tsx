import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FileText, ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { saveDigitizedFile, type DigitizedPatientData } from "@/lib/nurse-service";
import { toast } from "sonner";
import { createWorker } from "tesseract.js";

export const Route = createFileRoute("/nurse/digitize")({ component: Digitize });

const EMPTY_RESULT: DigitizedPatientData = {
  fullName: "",
  idNumber: "",
  dateOfBirth: "",
  cellphone: "",
  diagnosis: "",
  currentMedication: "",
  notes: "",
};

// Pulls labeled fields out of raw OCR text (e.g. "Full Name: Lindiwe
// Mahlangu"). Falls back to pattern matching for ID numbers / phone
// numbers when there's no label, since scanned/handwritten forms are
// inconsistent about labeling. Tune these patterns against your actual
// patient file layout once you've scanned a few real ones.
function parseOcrText(raw: string): DigitizedPatientData {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const grab = (labelPattern: RegExp): string | undefined => {
    for (const line of lines) {
      const m = line.match(labelPattern);
      if (m) return m[1]?.trim();
    }
    return undefined;
  };

  return {
    fullName: grab(/(?:full name|name)[:\-]\s*(.+)/i) ?? "",
    idNumber:
      grab(/id (?:number|no)[:\-]\s*([\d\s]+)/i)?.replace(/\s/g, "") ??
      raw.match(/\b\d{13}\b/)?.[0] ?? // bare 13-digit SA ID number as fallback
      "",
    dateOfBirth: grab(/(?:date of birth|dob)[:\-]\s*([\d/\-]+)/i) ?? "",
    cellphone:
      grab(/(?:cell|phone|mobile)[:\-]\s*([\d\s]+)/i)?.replace(/\s/g, "") ??
      raw.match(/\b0\d{9}\b/)?.[0] ??
      "",
    diagnosis: grab(/diagnosis[:\-]\s*(.+)/i) ?? "",
    currentMedication: grab(/(?:current medication|medication|meds)[:\-]\s*(.+)/i) ?? "",
    notes: grab(/notes?[:\-]\s*(.+)/i) ?? "",
  };
}

function Digitize() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<DigitizedPatientData | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const startScan = () => fileInputRef.current?.click();

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting the same file for a re-scan

    setPreview(URL.createObjectURL(file));
    setScanning(true);
    setResult(null);
    setConfidence(null);

    try {
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(file);
      await worker.terminate();

      setConfidence(Math.round(data.confidence));
      const parsed = parseOcrText(data.text);
      // If nothing matched at all, don't hand the nurse a wall of blank
      // fields silently — at least drop the raw text into notes so it's
      // not lost.
      const gotNothing = Object.values(parsed).every((v) => !v);
      setResult(gotNothing ? { ...EMPTY_RESULT, notes: data.text.trim() } : parsed);
    } catch {
      toast.error("OCR scan failed — try a clearer photo");
      setPreview(null);
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const saved = await saveDigitizedFile(result);
      toast.success(
        saved.matchedExisting
          ? `Updated existing patient ${saved.patientId}`
          : `Created new patient ${saved.patientId}`,
      );
      setResult(null);
      setPreview(null);
      setConfidence(null);
    } catch {
      toast.error("Could not save digitized file");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    setResult(null);
    setPreview(null);
    setConfidence(null);
  };

  const updateField = (field: keyof DigitizedPatientData, value: string) => {
    if (!result) return;
    setResult({ ...result, [field]: value });
  };

  return (
    <AppShell role="nurse" title="Digitize Patient Files">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-1">Scan Patient File</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Use OCR to extract patient data from physical files. Review every field below before saving —
            handwritten or low-quality scans can misread characters.
          </p>
          <div className="border-2 border-dashed rounded-lg aspect-[4/3] flex flex-col items-center justify-center bg-secondary/30 mb-4 overflow-hidden">
            {preview ? (
              <img src={preview} alt="Scanned patient file" className="w-full h-full object-contain" />
            ) : (
              <>
                <FileText size={48} className={`text-muted-foreground/50 ${scanning ? "animate-pulse" : ""}`} />
                <p className="text-sm text-muted-foreground mt-3">
                  {scanning ? "Scanning..." : "Position patient file in camera view"}
                </p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileSelected}
            className="hidden"
          />
          <button
            onClick={startScan}
            disabled={scanning}
            className="flex items-center gap-2 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            <ScanLine size={15} /> {scanning ? "Scanning…" : "Start Scan"}
          </button>
        </div>

        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-4">
            Extracted Data{" "}
            {confidence != null && (
              <span className="text-sm font-normal text-muted-foreground">({confidence}% confidence)</span>
            )}
          </h3>
          {result ? (
            <div className="space-y-3 text-sm">
              <EditableField label="Full Name" value={result.fullName} onChange={(v) => updateField("fullName", v)} />
              <div className="grid grid-cols-2 gap-3">
                <EditableField label="ID Number" value={result.idNumber} onChange={(v) => updateField("idNumber", v)} />
                <EditableField label="Date of Birth" value={result.dateOfBirth} onChange={(v) => updateField("dateOfBirth", v)} />
              </div>
              <EditableField label="Cellphone" value={result.cellphone} onChange={(v) => updateField("cellphone", v)} />
              <EditableField label="Diagnosis" value={result.diagnosis} onChange={(v) => updateField("diagnosis", v)} />
              <EditableField label="Current Medication" value={result.currentMedication} onChange={(v) => updateField("currentMedication", v)} />
              <EditableField label="Notes" value={result.notes} onChange={(v) => updateField("notes", v)} multiline />
              <div className="flex gap-2 pt-2">
                <button
                  onClick={save}
                  disabled={saving || !result.fullName || !result.idNumber}
                  title={!result.fullName || !result.idNumber ? "Full name and ID number are required" : undefined}
                  className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save to Database"}
                </button>
                <button onClick={clear} className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">
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

function EditableField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] resize-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
        />
      )}
    </div>
  );
}
