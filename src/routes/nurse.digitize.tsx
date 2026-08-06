import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FileText, ScanLine, Upload, AlertTriangle, Check } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { recogniseImage, parsePatientFile, REVIEW_THRESHOLD, type ParsedFields } from "@/lib/ocr";
import { saveDigitisedRecord } from "@/lib/clinic-data";

export const Route = createFileRoute("/nurse/digitize")({ component: Digitize });

const EMPTY: ParsedFields = {
  fullName: "", idNumber: "", dob: "", cell: "", diagnosis: "", medication: "", notes: "",
};

function Digitize() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [fields, setFields] = useState<ParsedFields>(EMPTY);
  const [patientId, setPatientId] = useState("");

  const scanned = confidence !== null;
  const lowConfidence = scanned && confidence < REVIEW_THRESHOLD;
  const set = (k: keyof ParsedFields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  const handleFile = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setScanning(true);
    setProgress(0);
    setConfidence(null);
    try {
      const res = await recogniseImage(file, setProgress);
      setRawText(res.text);
      setFields(parsePatientFile(res.text));
      setConfidence(res.confidence);
      if (!res.text.trim()) toast.warning("No text could be read from that image — try a clearer photo.");
      else toast.success(`Scan complete — ${Math.round(res.confidence)}% confidence`);
    } catch (e) {
      console.error(e);
      toast.error("Could not run OCR on that file");
    } finally {
      setScanning(false);
    }
  };

  const save = useMutation({
    mutationFn: () =>
      saveDigitisedRecord({
        patientId,
        fullName: fields.fullName,
        idNumber: fields.idNumber,
        dob: fields.dob,
        cell: fields.cell,
        diagnosis: fields.diagnosis,
        medication: fields.medication,
        notes: fields.notes,
        rawText,
        confidence: confidence ?? 0,
      }),
    onSuccess: (res) => {
      if (!res.ok) return toast.error(res.error ?? "Could not save");
      toast.success(`Filed to ${patientId}'s medical record`);
      clear();
    },
    onError: () => toast.error("Could not save to the database"),
  });

  const clear = () => {
    setPreview(null); setConfidence(null); setRawText(""); setFields(EMPTY);
    setPatientId(""); setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <AppShell role="nurse" title="Digitize Patient Files">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------------- scan panel ---------------- */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-1">Scan Patient File</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Photograph or upload a paper file. Text is read on-device — nothing is uploaded to a
            third party. Fields below {REVIEW_THRESHOLD}% confidence are flagged for review.
          </p>

          <label
            htmlFor="ocr-file"
            className="border-2 border-dashed rounded-lg aspect-[4/3] flex flex-col items-center justify-center bg-secondary/30 mb-4 cursor-pointer hover:bg-secondary/50 transition overflow-hidden"
          >
            {preview ? (
              <img src={preview} alt="Scanned file" className="w-full h-full object-contain" />
            ) : (
              <>
                <FileText size={48} className={`text-muted-foreground/50 ${scanning ? "animate-pulse" : ""}`} />
                <p className="text-sm text-muted-foreground mt-3">Tap to photograph or upload a file</p>
                <p className="text-xs text-muted-foreground/70 mt-1">JPG or PNG</p>
              </>
            )}
          </label>
          <input
            id="ocr-file"
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {scanning && (
            <div className="mb-4">
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-[oklch(0.55_0.18_245)] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">Reading text… {progress}%</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="flex items-center gap-2 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
            >
              {scanning ? <ScanLine size={15} className="animate-pulse" /> : <Upload size={15} />}
              {scanning ? "Scanning…" : preview ? "Choose another file" : "Select file"}
            </button>
            {rawText && (
              <button onClick={() => setShowRaw((v) => !v)} className="border px-3 py-2 rounded-md text-sm hover:bg-secondary">
                {showRaw ? "Hide" : "View"} raw text
              </button>
            )}
          </div>

          {showRaw && (
            <pre className="mt-3 text-[11px] bg-secondary/40 border rounded-md p-3 max-h-48 overflow-auto whitespace-pre-wrap">
              {rawText || "(nothing read)"}
            </pre>
          )}
        </div>

        {/* ---------------- extracted data ---------------- */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold">Extracted Data</h3>
            {scanned && (
              <span
                className={`text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 ${
                  lowConfidence
                    ? "bg-[oklch(0.96_0.1_85)] text-[oklch(0.4_0.15_70)]"
                    : "bg-[oklch(0.94_0.08_160)] text-[oklch(0.3_0.15_160)]"
                }`}
              >
                {lowConfidence ? <AlertTriangle size={11} /> : <Check size={11} />}
                {Math.round(confidence!)}% confidence
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {scanned
              ? "Check every field against the paper original before saving — OCR makes mistakes."
              : "No data extracted yet. Scan a file to begin."}
          </p>

          {scanned && (
            <div className="space-y-3 text-sm">
              {lowConfidence && (
                <p className="text-xs bg-[oklch(0.98_0.05_85)] border border-[oklch(0.85_0.12_85)] rounded-md p-2.5 text-[oklch(0.4_0.15_70)]">
                  Low confidence scan — verify each field carefully, or rescan with better lighting.
                </p>
              )}

              <Field label="Patient ID *" value={patientId} onChange={setPatientId} placeholder="e.g. Pat-3" mono />
              <Field label="Full Name" value={fields.fullName} onChange={set("fullName")} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="ID Number" value={fields.idNumber} onChange={set("idNumber")} />
                <Field label="Date of Birth" value={fields.dob} onChange={set("dob")} />
              </div>
              <Field label="Cellphone" value={fields.cell} onChange={set("cell")} />
              <Field label="Diagnosis" value={fields.diagnosis} onChange={set("diagnosis")} />
              <Field label="Current Medication" value={fields.medication} onChange={set("medication")} />
              <Field label="Notes" value={fields.notes} onChange={set("notes")} multiline />

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    if (!patientId.trim()) return toast.error("Enter the Patient ID this file belongs to");
                    save.mutate();
                  }}
                  disabled={save.isPending}
                  className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
                >
                  {save.isPending ? "Saving…" : "Save to Database"}
                </button>
                <button onClick={clear} className="border px-4 py-2 rounded-md text-sm hover:bg-secondary">
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  label, value, onChange, placeholder, multiline, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; mono?: boolean;
}) {
  const cls = `w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] ${mono ? "font-mono" : ""}`;
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} min-h-20`} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </div>
  );
}
