// Server-only HTTP handlers for SMS reminders. Both endpoints are called by
// machines, not people, so each requires its own shared secret and refuses
// every request while that secret is unset.
import { processDueAppointmentReminders } from "../lib/appointment-reminders";
import { handleInboundSmsReply } from "../lib/sms-replies";
import { readInboundSmsPayload } from "../lib/smsportal";
import { readEnv } from "./env";
import { FirestoreConfigError, firestoreAdminFromEnv } from "./firestore-admin";
import { bearerToken, tokenMatches } from "./request-auth";

/**
 * POST (or GET) /api/sms/inbound — SMSPortal's "SMS Replies" webhook.
 *
 * Configure the webhook in SMSPortal with the custom header
 * `Authorization: Bearer <SMSPORTAL_WEBHOOK_SECRET>`. The secret is not
 * accepted in the URL, where it would end up in request logs.
 */
export async function handleSmsInboundRequest(request: Request, url: URL, env: unknown): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET") {
    return Response.json({ ok: false, reason: "method-not-allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
  }

  const secret = readEnv(env, "SMSPORTAL_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[sms-webhook] SMSPORTAL_WEBHOOK_SECRET is not set; rejecting request");
    return Response.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }
  if (!tokenMatches(bearerToken(request), secret)) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  try {
    const reply = await readInboundSmsPayload(request, url);
    const result = await handleInboundSmsReply(reply, firestoreAdminFromEnv(env), env);

    // SMSPortal retries anything that isn't a 2xx. A reply that can't be
    // acted on (no 1/2, unknown number) won't succeed on retry either, so it
    // is acknowledged with 200 and reported in the body.
    if (!result.ok) {
      console.warn("[sms-webhook] reply not applied:", result.reason);
      return Response.json({ ok: false, reason: result.reason });
    }
    return Response.json({ ok: true, action: result.action, cancelled: result.cancelled ?? false });
  } catch (error) {
    console.error("[sms-webhook] failed:", error);
    if (error instanceof FirestoreConfigError) {
      return Response.json({ ok: false, reason: "not-configured" }, { status: 503 });
    }
    return Response.json({ ok: false, reason: "internal-error" }, { status: 500 });
  }
}

/**
 * POST /api/sms/reminders — runs the reminder job now, for testing or a
 * missed cron. Requires `Authorization: Bearer <SMS_REMINDER_TRIGGER_SECRET>`.
 *
 * POST /api/sms/reminders?test=now — testing only: sends each upcoming
 * appointment's next reminder immediately, outside the usual time windows.
 * Refused unless SMS_ONLY_TO is set, so it can only ever text listed numbers.
 */
export async function handleReminderTriggerRequest(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ ok: false, reason: "method-not-allowed" }, { status: 405, headers: { Allow: "POST" } });
  }

  const secret = readEnv(env, "SMS_REMINDER_TRIGGER_SECRET");
  if (!secret) {
    console.error("[sms-reminders] SMS_REMINDER_TRIGGER_SECRET is not set; rejecting request");
    return Response.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }
  if (!tokenMatches(bearerToken(request), secret)) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const sendNow = new URL(request.url).searchParams.get("test") === "now";
  if (sendNow && !readEnv(env, "SMS_ONLY_TO")) {
    return Response.json({ ok: false, reason: "test-needs-sms-only-to" }, { status: 400 });
  }

  try {
    const results = await processDueAppointmentReminders(new Date(), env, { sendNow });
    return Response.json({ ok: true, results });
  } catch (error) {
    console.error("[sms-reminders] failed:", error);
    if (error instanceof FirestoreConfigError) {
      return Response.json({ ok: false, reason: "not-configured" }, { status: 503 });
    }
    return Response.json({ ok: false, reason: "reminder-run-failed" }, { status: 500 });
  }
}
