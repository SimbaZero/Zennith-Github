// PROTOTYPE ONLY — see conversation notes.
// TODO(security): the Gemini API key is exposed in the client bundle
// (VITE_-prefixed env vars are public — same as Firebase's key, but
// unlike RESEND_API_KEY there's no server here to hide this one behind).
// Anyone who opens DevTools can read and reuse this key. Move this
// behind a real backend (Firebase Cloud Function) before real use.
// TODO(compliance): Google's Gemini API free tier terms allow prompts/
// images sent through it to be used to improve Google's products. Do
// NOT run a real patient's real photo through this until this is on a
// paid tier or moved server-side. Fake/synthetic test patients only.

import type { DigitizedPatientData } from "@/lib/nurse-service";

// If this model name ever 404s, check https://ai.google.dev/gemini-api/docs/models
// for the current free-tier model list and swap it in here.
const GEMINI_MODEL = "gemini-2.5-flash";

const PROMPT = `You are reading a scanned or photographed handwritten or
printed clinic patient file. Extract the following fields as JSON only:

{
  "fullName": string,
  "idNumber": string,       // digits only, South African 13-digit ID if present
  "dateOfBirth": string,    // YYYY-MM-DD if determinable, else ""
  "cellphone": string,      // digits only
  "diagnosis": string,
  "currentMedication": string,
  "notes": string,          // anything else relevant that doesn't fit above
  "confidence": number      // your own 0-100 estimate of extraction confidence
}

If a field isn't visible in the image, use an empty string for it. Never
invent information that isn't visible in the image.`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:image/jpeg;base64," prefix — Gemini wants raw base64
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface GeminiExtractionResult {
  data: DigitizedPatientData;
  confidence: number;
}

export async function extractPatientDataWithGemini(
  image: Blob,
): Promise<GeminiExtractionResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error(
      "VITE_GEMINI_API_KEY is not set — add it to your .env file, then restart the dev server.",
    );
  }

  const base64 = await blobToBase64(image);
  const mimeType = image.type || "image/jpeg";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const text: string | undefined =
    json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no extractable text");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini response wasn't valid JSON — try scanning again");
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  return {
    data: {
      fullName: str(parsed.fullName),
      idNumber: str(parsed.idNumber).replace(/\D/g, ""),
      dateOfBirth: str(parsed.dateOfBirth),
      cellphone: str(parsed.cellphone).replace(/\D/g, ""),
      diagnosis: str(parsed.diagnosis),
      currentMedication: str(parsed.currentMedication),
      notes: str(parsed.notes),
    },
    confidence: Math.round(num(parsed.confidence)),
  };
}
