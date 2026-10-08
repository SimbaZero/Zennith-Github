import { createServerFn } from "@tanstack/react-start";

// Text-message sign-in codes for patients: the server functions the
// two-factor page calls. The work happens in src/server/sms-otp.ts, loaded
// inside each handler so none of it (or the service-account code it uses)
// ends up in the browser bundle.

export type SmsCodeFailure =
  | "not-configured"
  | "unauthenticated"
  | "not-eligible"
  | "no-phone"
  | "cooldown"
  | "rate-limited"
  | "send-failed"
  | "expired"
  | "invalid-code"
  | "too-many-attempts"
  | "busy";

export type SendSmsCodeResult =
  | { ok: true; phoneLast4: string; resendAt: number }
  | { ok: false; reason: SmsCodeFailure; retryAt?: number; phoneLast4?: string };

export type VerifySmsCodeResult = { ok: true } | { ok: false; reason: SmsCodeFailure; attemptsLeft?: number };

export const sendSmsCode = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string }) => d)
  .handler(async ({ data }): Promise<SendSmsCodeResult> => {
    const { requestSmsCode } = await import("../server/sms-otp");
    return requestSmsCode(data?.idToken);
  });

export const verifySmsCode = createServerFn({ method: "POST" })
  .inputValidator((d: { idToken: string; code: string }) => d)
  .handler(async ({ data }): Promise<VerifySmsCodeResult> => {
    const { checkSmsCode } = await import("../server/sms-otp");
    return checkSmsCode(data?.idToken, data?.code);
  });
