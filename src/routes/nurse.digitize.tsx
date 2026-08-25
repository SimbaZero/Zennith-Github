import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Camera, FileText, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  saveDigitizedFile,
  useCurrentNurse,
  type DigitizedPatientData,
} from "@/lib/nurse-service";
import { extractPatientDataWithGemini } from "@/lib/gemini-ocr";
import { toast } from "sonner";

export const Route = createFileRoute("/nurse/digitize")({
  component: Digitize,
});

function Digitize() {
  const { nurse } = useCurrentNurse();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<DigitizedPatientData | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (err) {
      console.error("Camera access failed:", err);
      toast.error(
        "Couldn't access the camera — check your browser's camera permission for this site, or use Upload Image instead.",
      );
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error("Couldn't capture that frame — try again");
          return;
        }
        stopCamera();
        void runExtraction(blob);
      },
      "image/jpeg",
      0.92,
    );
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void runExtraction(file);
  };

  const runExtraction = async (file: File | Blob) => {
    cancelledRef.current = false;
    setPreview(URL.createObjectURL(file));
    setScanning(true);
    setResult(null);
    setConfidence(null);

    try {
      const { data, confidence: conf } =
        await extractPatientDataWithGemini(file);
      if (cancelledRef.current) return;
      setConfidence(conf);
      setResult(data);
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("Gemini extraction failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Extraction failed — try a clearer photo",
      );
      setPreview(null);
    } finally {
      if (!cancelledRef.current) setScanning(false);
    }
  };

  const cancelScan = () => {
    cancelledRef.current = true;
    setScanning(false);
    setResult(null);
    setPreview(null);
    setConfidence(null);
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const saved = await saveDigitizedFile(result, nurse?.clinicId);
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

  const updateField = (field: keyof DigitizedPatientData, value: string) => {
    if (!result) return;
    setResult({ ...result, [field]: value });
  };

  return (
    <AppShell
      role="nurse"
      title="Digitize Patient Files"
      staffNameOverride={nurse?.fullName}
      clinicNameOverride={nurse?.clinicName}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold mb-1">Scan Patient File</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Use OCR to extract patient data from physical files. Review every
            field below before saving — handwritten or low-quality scans can
            misread characters.
          </p>

          <div className="border-2 border-dashed rounded-lg aspect-[4/3] flex flex-col items-center justify-center bg-secondary/30 mb-4 overflow-hidden relative">
            {cameraOpen ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={stopCamera}
                  className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1.5 hover:bg-black/70"
                  aria-label="Close camera"
                >
                  <X size={16} />
                </button>
                <button
                  onClick={capturePhoto}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white text-[oklch(0.18_0.06_260)] px-5 py-2 rounded-full text-sm font-medium shadow-lg hover:bg-white/90"
                >
                  Capture
                </button>
              </>
            ) : preview ? (
              <>
                <img
                  src={preview}
                  alt="Scanned patient file"
                  className="w-full h-full object-contain"
                />
                <button
                  onClick={cancelScan}
                  className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1.5 hover:bg-black/70"
                  aria-label="Cancel"
                  title="Cancel"
                >
                  <X size={16} />
                </button>
                {scanning && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                    Reading file…
                  </div>
                )}
              </>
            ) : (
              <>
                <FileText size={48} className="text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground mt-3">
                  Take a photo or upload a patient file
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelected}
            className="hidden"
          />

          {!cameraOpen && !preview && (
            <div className="flex gap-2">
              <button
                onClick={openCamera}
                className="flex items-center gap-2 bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)]"
              >
                <Camera size={15} /> Take Photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 border px-4 py-2 rounded-md text-sm hover:bg-secondary"
              >
                <Upload size={15} /> Upload Image
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border p-6 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <h3 className="font-semibold mb-1">
            Extracted Data{" "}
            {confidence != null && (
              <span className="text-sm font-normal text-muted-foreground">
                ({confidence}% confidence)
              </span>
            )}
          </h3>
          {result && (
            <p
              className={`text-xs mb-4 ${
                confidence != null && confidence < 85
                  ? "text-amber-600"
                  : "text-muted-foreground"
              }`}
            >
              Always double-check every field against the original file before
              saving — especially names and ID numbers.
            </p>
          )}
          {result ? (
            <div className="space-y-5 text-sm">
              <div>
                <h4 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground mb-2">
                  PERSONAL INFORMATION
                </h4>
                <div className="space-y-3">
                  <EditableField
                    label="Full Name"
                    value={result.fullName}
                    onChange={(v) => updateField("fullName", v)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="ID Number"
                      value={result.idNumber}
                      onChange={(v) => updateField("idNumber", v)}
                    />
                    <EditableField
                      label="Date of Birth"
                      value={result.dateOfBirth}
                      onChange={(v) => updateField("dateOfBirth", v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="Cellphone"
                      value={result.cellphone}
                      onChange={(v) => updateField("cellphone", v)}
                    />
                    <EditableField
                      label="Email"
                      value={result.email}
                      onChange={(v) => updateField("email", v)}
                    />
                  </div>
                  <EditableField
                    label="Address"
                    value={result.address}
                    onChange={(v) => updateField("address", v)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="Emergency Contact"
                      value={result.emergencyContactName}
                      onChange={(v) => updateField("emergencyContactName", v)}
                    />
                    <EditableField
                      label="Emergency Phone"
                      value={result.emergencyContactNo}
                      onChange={(v) => updateField("emergencyContactNo", v)}
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground mb-2">
                  MEDICAL HISTORY
                </h4>
                <div className="space-y-3">
                  <EditableField
                    label="Primary Condition / Diagnosis"
                    value={result.diagnosis}
                    onChange={(v) => updateField("diagnosis", v)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="Blood Type"
                      value={result.bloodType}
                      onChange={(v) => updateField("bloodType", v)}
                    />
                    <EditableField
                      label="Blood Pressure"
                      value={result.bloodPressure}
                      onChange={(v) => updateField("bloodPressure", v)}
                    />
                  </div>
                  <EditableField
                    label="Allergies"
                    value={result.allergies}
                    onChange={(v) => updateField("allergies", v)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField
                      label="Current Medication"
                      value={result.currentMedication}
                      onChange={(v) => updateField("currentMedication", v)}
                    />
                    <EditableField
                      label="Dosage"
                      value={result.dosage}
                      onChange={(v) => updateField("dosage", v)}
                    />
                  </div>
                  <EditableField
                    label="Glucose"
                    value={result.glucose}
                    onChange={(v) => updateField("glucose", v)}
                  />
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground mb-2">
                  CLINICAL NOTES
                </h4>
                <EditableField
                  label="Notes"
                  value={result.notes}
                  onChange={(v) => updateField("notes", v)}
                  multiline
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={save}
                  disabled={saving || !result.fullName || !result.idNumber}
                  title={
                    !result.fullName || !result.idNumber
                      ? "Full name and ID number are required"
                      : undefined
                  }
                  className="bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save to Database"}
                </button>
                <button
                  onClick={cancelScan}
                  className="border px-4 py-2 rounded-md text-sm hover:bg-secondary"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No data extracted yet. Take a photo or upload a file to begin.
            </p>
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
      <label className="text-xs text-muted-foreground block mb-1">
        {label}
      </label>
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
