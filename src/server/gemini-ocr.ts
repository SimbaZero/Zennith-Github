// Server-only: reads a scanned patient form with Gemini.
//
// This used to run in the browser with a VITE_-prefixed key, which put the key
// into the public JavaScript bundle where anyone could copy it. It now runs
// here: the key (GEMINI_API_KEY, a server secret) never leaves the server, and
// the caller must be a signed-in clinic staff member, identified by their
// Firebase ID token.
//
// TODO(compliance): Google's Gemini API free tier terms allow prompts/images
// sent through it to be used to improve Google's products. Do NOT run a real
// patient's real photo through this until this is on a paid tier. Fake or
// synthetic test patients only.
import type { DigitizedPatientData } from "../lib/nurse-service";
import type { ScanResult } from "../lib/gemini-ocr";
import { readEnv } from "./env";
import { verifyIdToken } from "./firebase-auth";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
} from "./firestore-admin";

// If this model name ever 404s, check https://ai.google.dev/gemini-api/docs/models
// for the current free-tier model list and swap it in here.
const GEMINI_MODEL = "gemini-flash-lite-latest";

/** Roles that digitize paper files. */
const ALLOWED_ROLES = ["nurse", "doctor", "receptionist", "admin"];

/** Base64 characters; about 7 MB of image. A phone photo is well under this. */
const MAX_BASE64_LENGTH = 10_000_000;

// Expanded to match the real Medical Record page's Personal Information +
// Medical History sections, not just the original 7-field subset — so a
// scan can populate a record as fully as the paper form allows.
const PROMPT = `You are reading a scanned or photographed handwritten or
printed clinic patient intake/history form. Extract the following fields
as JSON only:

{
  "fullName": string,
  "idNumber": string,          // digits only, South African 13-digit ID if present
  "dateOfBirth": string,       // YYYY-MM-DD if determinable, else ""
  "cellphone": string,         // digits only
  "email": string,
  "address": string,           // whatever address is written, as one string
  "emergencyContactName": string,
  "emergencyContactNo": string,
  "diagnosis": string,         // primary condition
  "bloodType": string,
  "allergies": string,
  "currentMedication": string,
  "dosage": string,            // as written, e.g. "500mg" — digits get extracted separately
  "bloodPressure": string,     // e.g. "120/80"
  "glucose": string,           // as written, digits get extracted separately
  "notes": string,             // anything else relevant that doesn't fit above
  "confidence": number         // your own 0-100 estimate of extraction confidence
}

If a field isn't visible in the image, use an empty string for it. Never
invent information that isn't visible in the image.`;

function adminOrNull(env: unknown): FirestoreAdmin | null {
  try {
    return firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError) return null;
    throw error;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Turns Gemini's JSON answer into the fields the digitize form fills in. */
export function toDigitizedData(parsed: Record<string, unknown>): {
  data: DigitizedPatientData;
  confidence: number;
} {
  return {
    data: {
      fullName: str(parsed.fullName),
      idNumber: str(parsed.idNumber).replace(/\D/g, ""),
      dateOfBirth: str(parsed.dateOfBirth),
      cellphone: str(parsed.cellphone).replace(/\D/g, ""),
      email: str(parsed.email),
      address: str(parsed.address),
      emergencyContactName: str(parsed.emergencyContactName),
      emergencyContactNo: str(parsed.emergencyContactNo).replace(/\D/g, ""),
      diagnosis: str(parsed.diagnosis),
      bloodType: str(parsed.bloodType),
      allergies: str(parsed.allergies),
      currentMedication: str(parsed.currentMedication),
      dosage: str(parsed.dosage),
      bloodPressure: str(parsed.bloodPressure),
      glucose: str(parsed.glucose),
      notes: str(parsed.notes),
    },
    confidence: Math.round(num(parsed.confidence)),
  };
}

export async function readScan(args: {
  idToken: unknown;
  imageBase64: unknown;
  mimeType: unknown;
  env?: unknown;
}): Promise<ScanResult> {
  const apiKey = readEnv(args.env, "GEMINI_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      kind: "unavailable",
      detail:
        "GEMINI_API_KEY is not set on the server (add it to .env, or `wrangler secret put GEMINI_API_KEY`).",
    };
  }
  const fs = adminOrNull(args.env);
  if (!fs)
    return { ok: false, kind: "unavailable", detail: "server not configured" };

  const uid = await verifyIdToken(args.idToken, fs.projectId);
  if (!uid)
    return { ok: false, kind: "unauthenticated", detail: "no valid sign-in" };
  const profile = (await fs.get("profiles", uid))?.data;
  if (!profile || !ALLOWED_ROLES.includes(String(profile.role)))
    return {
      ok: false,
      kind: "not-eligible",
      detail: `role ${String(profile?.role)}`,
    };

  const image = typeof args.imageBase64 === "string" ? args.imageBase64 : "";
  const mimeType =
    typeof args.mimeType === "string" &&
    /^image\/[a-z0-9.+-]+$/i.test(args.mimeType)
      ? args.mimeType
      : "image/jpeg";
  if (!image || image.length > MAX_BASE64_LENGTH)
    return {
      ok: false,
      kind: "unreadable",
      detail: image ? "image too large" : "no image",
    };

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        // The key goes in a header, not the URL, so it can't end up in a log line.
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mimeType, data: image } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
  } catch (err) {
    return {
      ok: false,
      kind: "unavailable",
      detail: `request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // 4xx/5xx from the service is not the scan's fault: say "unavailable".
    return {
      ok: false,
      kind: "unavailable",
      detail: `Gemini API error ${res.status}: ${errText.slice(0, 200)}`,
    };
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text)
    return {
      ok: false,
      kind: "unreadable",
      detail: "Gemini returned no extractable text",
    };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      kind: "unreadable",
      detail: "Gemini response wasn't valid JSON — try scanning again",
    };
  }
  return { ok: true, ...toDigitizedData(parsed) };
}
