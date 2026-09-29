// ---------------------------------------------------------------------------
// Clinic decision emails (approved / rejected) — the parts that don't depend on
// any framework, so they can be tested on their own. The server function that
// actually sends is in clinic-decision-email.ts.
//
// SAFETY: the endpoint that sends these is reachable from the internet, so it
// must not be usable by strangers to send Zennith-branded email to any address.
// verifySuperAdmin() therefore proves, using Google's own services, that the
// caller holds a valid sign-in for an account whose profile role is
// "super_admin". It fails closed: if anything can't be confirmed, no email is
// sent.
//
// It does two lookups, deliberately:
//   1. Google's Identity Toolkit turns the sign-in token into the account's id.
//      The account id is taken from Google's answer, never from the caller.
//   2. Firestore is asked for that account's profile using the same token.
// ---------------------------------------------------------------------------

export interface DecisionEmailInput {
  outcome: "approved" | "rejected";
  email: string;
  contactName: string;
  clinicName: string;
  clinicId?: number;
  type?: "public" | "private";
  /** Written for the applicant. Only used for rejections. */
  reason?: string;
  /** Private clinics: a short description of the plan they chose. */
  billingSummary?: string;
}

export type VerifyResult =
  | { ok: true; uid: string }
  | {
      ok: false;
      reason: "unauthenticated" | "not-super-admin" | "verify-failed";
    };

export async function verifySuperAdmin(
  idToken: string,
  cfg: { apiKey?: string; projectId?: string },
  fetchFn: typeof fetch = fetch,
): Promise<VerifyResult> {
  if (!idToken) return { ok: false, reason: "unauthenticated" };
  if (!cfg.apiKey || !cfg.projectId)
    return { ok: false, reason: "verify-failed" };

  try {
    const lookup = await fetchFn(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!lookup.ok) {
      return {
        ok: false,
        reason: lookup.status >= 500 ? "verify-failed" : "unauthenticated",
      };
    }
    const lookupBody = (await lookup.json()) as {
      users?: { localId?: string }[];
    };
    const uid = lookupBody.users?.[0]?.localId;
    if (typeof uid !== "string" || !uid)
      return { ok: false, reason: "unauthenticated" };

    const profile = await fetchFn(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/profiles/${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
    if (!profile.ok) return { ok: false, reason: "verify-failed" };
    const profileBody = (await profile.json()) as {
      fields?: { role?: { stringValue?: string } };
    };
    return profileBody.fields?.role?.stringValue === "super_admin"
      ? { ok: true, uid }
      : { ok: false, reason: "not-super-admin" };
  } catch {
    return { ok: false, reason: "verify-failed" };
  }
}

export function isPlausibleEmail(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

export function decisionSubject(
  outcome: "approved" | "rejected",
  clinicName: string,
): string {
  const name = clamp(clinicName, 120);
  return outcome === "approved"
    ? `${name} has been approved on Zennith`
    : `Update on your Zennith application for ${name}`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:2px 0;color:#6b7280;font-size:13px">${label}</td><td style="padding:2px 0;text-align:right;font-weight:600">${value}</td></tr>`;
}

/** appUrl is only used when it is a real https address, so a missing or
 *  half-configured value can never produce a dead sign-in button. */
export function decisionHtml(
  input: DecisionEmailInput,
  appUrl?: string,
): string {
  const first = clamp(input.contactName, 120).split(/\s+/)[0] || "there";
  const clinic = escapeHtml(clamp(input.clinicName, 120));
  const safeFirst = escapeHtml(first);
  const approved = input.outcome === "approved";

  const button =
    approved && appUrl && /^https:\/\//i.test(appUrl)
      ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#1b2440;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">Open Zennith</a>`
      : "";

  const body = approved
    ? `<h1 style="margin:0 0 12px;font-size:20px">Good news, ${safeFirst}</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151">
            <strong>${clinic}</strong> has been reviewed and approved on Zennith Health Services.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 20px">
            ${row("Clinic", clinic)}
            ${input.clinicId != null ? row("Clinic ID", String(input.clinicId)) : ""}
            ${input.type ? row("Type", escapeHtml(input.type)) : ""}
          </table>
          <p style="margin:0 0 8px;font-size:14px;font-weight:600">What happens next</p>
          <ol style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.7;color:#374151">
            <li>Your clinic administrator account is created and you'll get a separate email to set a password.</li>
            <li>Sign in and add your staff: doctors, nurses, pharmacists and receptionists.</li>
            <li>Patients can then register and choose your clinic.</li>
          </ol>
          ${
            input.type === "private"
              ? `<p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b7280">${
                  clamp(input.billingSummary, 200)
                    ? `Your plan: ${escapeHtml(clamp(input.billingSummary, 200))}. `
                    : ""
                }Billing is confirmed with you directly, and nothing has been charged.</p>`
              : ""
          }
          ${button}`
    : `<h1 style="margin:0 0 12px;font-size:20px">Update on your application</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151">
            Hi ${safeFirst}, thank you for applying to register <strong>${clinic}</strong> on Zennith Health Services. After review, we are unable to approve the application at this time.
          </p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 20px">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;color:#6b7280">REASON</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#111827">${escapeHtml(clamp(input.reason, 600)).replace(/\n/g, "<br>")}</p>
          </div>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#374151">
            You are welcome to correct the details and apply again.
          </p>`;

  return `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <tr><td style="background:#1b2440;padding:28px 32px;text-align:center">
          <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">Zennith Health Services</div>
        </td></tr>
        <tr><td style="padding:32px">
          ${body}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #eef0f3">
          Zennith Health Services
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
