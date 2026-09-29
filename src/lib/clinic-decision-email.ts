import { createServerFn } from "@tanstack/react-start";
import {
  decisionHtml,
  decisionSubject,
  isPlausibleEmail,
  verifySuperAdmin,
  type DecisionEmailInput,
} from "@/lib/clinic-decision-core";

// Server-only: emails the person who applied to register a clinic, once a
// Super Admin has approved or rejected the application. Sent through Resend;
// the API key is read from the server environment and never reaches the
// browser.
//
// Unlike the patient welcome email, this checks WHO is asking (see
// verifySuperAdmin) so it can't be used to email arbitrary people.
//
// Emailing any address needs a verified sending domain (set RESEND_FROM).
// Until then Resend's shared sender only delivers to the account owner's own
// address, so the caller is told honestly when a send fails.

interface DecisionRequest extends DecisionEmailInput {
  /** The signed-in user's Firebase ID token, checked on the server. */
  idToken: string;
}

export const sendClinicDecisionEmail = createServerFn({ method: "POST" })
  .inputValidator((d: DecisionRequest) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
    const who = await verifySuperAdmin(data.idToken, {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    });
    if (!who.ok) return { ok: false, reason: who.reason };

    if (!isPlausibleEmail(data.email)) {
      return { ok: false, reason: "invalid-input" };
    }

    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("[email] RESEND_API_KEY not set — decision email skipped");
      return { ok: false, reason: "not-configured" };
    }
    const from =
      process.env.RESEND_FROM || "Zennith Health <onboarding@resend.dev>";

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [data.email.trim()],
          subject: decisionSubject(data.outcome, data.clinicName),
          html: decisionHtml(data, process.env.APP_URL),
        }),
      });
      if (!res.ok) {
        console.error(
          "[email] Resend send failed:",
          res.status,
          await res.text().catch(() => ""),
        );
        return { ok: false, reason: "send-failed" };
      }
      return { ok: true };
    } catch (e) {
      console.error("[email] Resend request error:", e);
      return { ok: false, reason: "send-failed" };
    }
  });
