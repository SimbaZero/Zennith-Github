// Server-only: sending texts through SMSPortal and reading its reply
// webhooks. Runs in the Worker (reminder cron, reply webhook), never in the
// browser.
import { readEnv } from "../server/env";

// https://docs.smsportal.com/reference/bulkmessages_postv3
const SMSPORTAL_SEND_URL = "https://rest.smsportal.com/v3/BulkMessages";

export function formatPhoneForSms(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+27${digits.slice(1)}`;
  if (digits.startsWith("27")) return `+${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

interface SmsPortalSendResponse {
  messages?: number;
  errorReport?: unknown;
}

export async function sendSms({
  to,
  message,
  testMode,
  env,
}: {
  to: string;
  message: string;
  testMode?: boolean;
  env?: unknown;
}): Promise<{ ok: boolean; dryRun?: boolean; reason?: string }> {
  const phone = formatPhoneForSms(to);
  if (!phone) return { ok: false, reason: "missing-phone" };

  // Testing on a database of demo patients: SMS_ONLY_TO (comma-separated
  // numbers) limits every text to those numbers, so nobody else is messaged.
  const onlyTo = readEnv(env, "SMS_ONLY_TO");
  if (onlyTo) {
    const allowed = new Set(onlyTo.split(",").map((n) => formatPhoneForSms(n.trim())).filter(Boolean));
    if (!allowed.has(phone)) {
      console.info(`[sms] not sent: SMS_ONLY_TO is set and ${phone.slice(0, 5)}***** isn't on it`);
      return { ok: false, reason: "not-on-sms-only-to" };
    }
  }

  const clientId = readEnv(env, "SMSPORTAL_CLIENT_ID") ?? "";
  const apiSecret = readEnv(env, "SMSPORTAL_API_SECRET") ?? "";
  const shouldTest = testMode ?? (readEnv(env, "SMSPORTAL_TEST_MODE") === "true");

  if (!clientId || !apiSecret || shouldTest) {
    console.info(`[sms:test] ${phone} :: ${message}`);
    return { ok: true, dryRun: true };
  }

  try {
    const auth = btoa(`${clientId}:${apiSecret}`);
    const res = await fetch(SMSPORTAL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // SMSPortal takes the MSISDN without the leading "+".
      body: JSON.stringify({ messages: [{ destination: phone.replace(/^\+/, ""), content: message }] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[sms] send failed:", res.status, text);
      return { ok: false, reason: `sms-provider:${res.status}` };
    }

    // A 200 can still reject the message (invalid number, opted out): it then
    // reports 0 enqueued messages and lists the problem in errorReport.
    const body = (await res.json().catch(() => null)) as
      | (SmsPortalSendResponse & { sendResponse?: SmsPortalSendResponse })
      | null;
    const report = body?.sendResponse ?? body;
    if (typeof report?.messages === "number" && report.messages < 1) {
      console.error("[sms] message not enqueued:", JSON.stringify(report.errorReport ?? {}));
      return { ok: false, reason: "sms-not-enqueued" };
    }

    return { ok: true };
  } catch (error) {
    console.error("[sms] request error:", error);
    return { ok: false, reason: "sms-error" };
  }
}

/**
 * Pulls the sender and reply text out of an SMSPortal "SMS Replies" webhook.
 *
 * SMSPortal's default POST template sends camelCase JSON (sourcePhoneNumber,
 * incomingData); GET webhooks carry the same values in the query string.
 * Keys are matched case-insensitively, and the older Msisdn/Message names
 * plus plain from/message are still accepted for custom templates.
 * https://docs.smsportal.com/docs/webhook-types-and-variables
 */
export async function readInboundSmsPayload(
  request: Request,
  url: URL,
): Promise<{ from: string; message: string }> {
  const fields = new Map<string, string>();
  const put = (key: string, value: unknown) => {
    if (value == null || typeof value === "object") return;
    fields.set(key.toLowerCase(), String(value));
  };

  url.searchParams.forEach((value, key) => put(key, value));

  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "POST" && contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    form?.forEach((value, key) => put(key, value));
  } else if (request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (contentType.includes("application/x-www-form-urlencoded")) {
      new URLSearchParams(raw).forEach((value, key) => put(key, value));
    } else if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) put(key, value);
        }
      } catch {
        // Not JSON; nothing more to read.
      }
    }
  }

  const pick = (...names: string[]) =>
    names.map((name) => fields.get(name)).find((value) => value !== undefined && value !== "") ?? "";

  return {
    from: pick("sourcephonenumber", "msisdn", "from"),
    message: pick("incomingdata", "message", "text", "body"),
  };
}
