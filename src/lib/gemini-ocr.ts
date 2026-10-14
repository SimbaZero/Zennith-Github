import { createServerFn } from "@tanstack/react-start";
import { auth } from "@/lib/firebase";
import type { DigitizedPatientData } from "@/lib/nurse-service";

// Reading a scanned patient form. The reading itself happens on the server
// (src/server/gemini-ocr.ts, loaded inside the handler so neither it nor its
// API key can end up in the browser bundle): this file sends the photo there
// and turns the answer back into the fields the digitize page fills in.

export type ScanResult =
  | { ok: true; data: DigitizedPatientData; confidence: number }
  | {
      ok: false;
      kind: "unreadable" | "unavailable" | "unauthenticated" | "not-eligible";
      detail: string;
    };

export const readScannedForm = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { idToken: string; imageBase64: string; mimeType: string }) => d,
  )
  .handler(async ({ data }): Promise<ScanResult> => {
    try {
      const { readScan } = await import("../server/gemini-ocr");
      return await readScan({
        idToken: data?.idToken,
        imageBase64: data?.imageBase64,
        mimeType: data?.mimeType,
      });
    } catch (error) {
      console.error("[gemini-ocr] failed:", error);
      return { ok: false, kind: "unavailable", detail: "server error" };
    }
  });

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:image/jpeg;base64," prefix — the reader wants raw base64
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * What a person is told when a scan can't be read. The technical cause (which
 * service, the HTTP status, a missing setting) is kept in `detail` for the
 * console and never put in front of the user: it is not something they can act
 * on, and it shouldn't reveal how the reading is done.
 */
export class ScanReadError extends Error {
  readonly kind: "unreadable" | "unavailable";
  readonly detail: string;
  constructor(kind: "unreadable" | "unavailable", detail: string) {
    super(
      kind === "unavailable"
        ? "Scan reading isn't available right now. Please enter the details by hand, or try again later."
        : "Couldn't read this scan clearly — try retaking the photo.",
    );
    this.name = "ScanReadError";
    this.kind = kind;
    this.detail = detail;
  }
}

export interface GeminiExtractionResult {
  data: DigitizedPatientData;
  confidence: number;
}

export async function extractPatientDataWithGemini(
  image: Blob,
): Promise<GeminiExtractionResult> {
  const idToken = (await auth.currentUser?.getIdToken()) ?? "";
  const imageBase64 = await blobToBase64(image);

  let result: ScanResult;
  try {
    result = await readScannedForm({
      data: { idToken, imageBase64, mimeType: image.type || "image/jpeg" },
    });
  } catch (err) {
    // Offline, blocked, DNS: the request never completed.
    throw new ScanReadError(
      "unavailable",
      `request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!result.ok) {
    throw new ScanReadError(
      result.kind === "unreadable" ? "unreadable" : "unavailable",
      result.detail,
    );
  }
  return { data: result.data, confidence: result.confidence };
}
