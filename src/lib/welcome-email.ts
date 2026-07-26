import { createServerFn } from "@tanstack/react-start";

// Server-only: sends the patient welcome/confirmation email via Resend.
// The API key is read from the server environment (Nitro loads .env in dev;
// Cloudflare exposes the Worker secret in prod), so it never reaches the browser.

interface WelcomeInput {
  email: string;
  name: string;
  patientId?: string;
}

function welcomeHtml(name: string, patientId?: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  const idLine = patientId
    ? `<tr><td style="padding:2px 0;color:#6b7280;font-size:13px">Patient ID</td><td style="padding:2px 0;text-align:right;font-family:monospace;font-weight:600">${patientId}</td></tr>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <tr><td style="background:#1b2440;padding:28px 32px;text-align:center">
          <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">Zennith Health Services</div>
          <div style="color:#93a4c7;font-size:10px;letter-spacing:3px;margin-top:4px">PEAK · PERFORMANCE · STANDARDS</div>
        </td></tr>
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 12px;font-size:20px">Welcome, ${first}!</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151">
            Your Zennith patient account has been created successfully. You can now sign in to
            view appointments, medical records, and messages from your care team.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 20px">
            <tr><td style="padding:2px 0;color:#6b7280;font-size:13px">Account</td><td style="padding:2px 0;text-align:right;font-weight:600">Patient portal</td></tr>
            ${idLine}
          </table>
          <a href="https://zennith-d6faa.web.app/login" style="display:inline-block;background:#1b2440;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">Sign in to Zennith</a>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#9ca3af">
            If you didn't create this account, please ignore this email or contact the clinic reception.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #eef0f3">
          Zennith Health Services · Hillbrow Community Health Centre
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export const sendWelcomeEmail = createServerFn({ method: "POST" })
  .inputValidator((d: WelcomeInput) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("[email] RESEND_API_KEY not set — welcome email skipped");
      return { ok: false, reason: "not-configured" };
    }
    // Resend's shared sender works without domain setup but only delivers to the
    // account owner's own address; set RESEND_FROM to a verified domain sender
    // to email arbitrary patients.
    const from = process.env.RESEND_FROM || "Zennith Health <onboarding@resend.dev>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [data.email],
          subject: "Welcome to Zennith Health Services",
          html: welcomeHtml(data.name, data.patientId),
        }),
      });
      if (!res.ok) {
        console.error("[email] Resend send failed:", res.status, await res.text().catch(() => ""));
        return { ok: false, reason: "send-failed" };
      }
      return { ok: true };
    } catch (e) {
      console.error("[email] Resend request error:", e);
      return { ok: false, reason: "send-failed" };
    }
  });
