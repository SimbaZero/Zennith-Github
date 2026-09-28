import "./lib/error-capture";

import { processDueAppointmentReminders } from "./lib/appointment-reminders";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleInboundSmsReply } from "./lib/smsportal";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    if (url.pathname === "/api/sms/inbound") {
      try {
        const contentType = request.headers.get("content-type") ?? "";
        let payload: Record<string, unknown> = {};

        if (contentType.includes("application/json")) {
          payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        } else {
          const form = await request.formData().catch(() => new FormData());
          payload = Object.fromEntries(form.entries());
        }

        const result = await handleInboundSmsReply({
          from: String(payload.from ?? ""),
          message: String(payload.message ?? payload.text ?? payload.body ?? ""),
          text: String(payload.text ?? ""),
          body: String(payload.body ?? ""),
        });

        if (!result.ok) {
          return Response.json({ ok: false, reason: result.reason }, { status: 400 });
        }

        return Response.json({ ok: true, action: result.action, patientId: result.patientId });
      } catch (error) {
        console.error("[sms-webhook] failed:", error);
        return Response.json({ ok: false, reason: "invalid-request" }, { status: 400 });
      }
    }

    if (url.pathname === "/api/sms/reminders" || url.pathname === "/__scheduled__") {
      try {
        const results = await processDueAppointmentReminders(new Date());
        return Response.json({ ok: true, results });
      } catch (error) {
        console.error("[sms-reminders] failed:", error);
        return Response.json({ ok: false, reason: "reminder-run-failed" }, { status: 500 });
      }
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
  async scheduled(_controller: unknown, _env: unknown, _ctx: unknown) {
    await processDueAppointmentReminders(new Date());
    return;
  },
};
