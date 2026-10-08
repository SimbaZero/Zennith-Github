import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Smartphone } from "lucide-react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import {
  setAuth,
  fetchTwoFactorProfile,
  saveTotpSecret,
  currentIdToken,
  type TwoFactorMethod,
  type TwoFactorProfile,
} from "@/lib/auth";
import {
  generateSecret,
  verifyTotp,
  otpauthUrl,
  formatSecret,
} from "@/lib/totp";
import {
  sendSmsCode,
  verifySmsCode,
  type SmsCodeFailure,
} from "@/lib/sms-otp";

export const Route = createFileRoute("/two-factor")({
  // Only the username travels in the URL, for display and the authenticator
  // account label. The role and facility are read from the signed-in user's
  // profile, so editing the URL can't change them.
  validateSearch: (s: Record<string, unknown>) => ({
    u: typeof s.u === "string" ? (s.u as string) : "",
  }),
  component: TwoFactor,
});

const EMPTY = ["", "", "", "", "", ""];

const PRIMARY_BUTTON =
  "w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60";

function TwoFactor() {
  const { u } = Route.useSearch();
  const navigate = useNavigate();
  const {
    data: profile,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["two-factor-profile", u],
    queryFn: fetchTwoFactorProfile,
    // Always read the profile fresh: a copy cached from an earlier visit could
    // show the wrong method (e.g. the choice screen after enrolling by SMS).
    gcTime: 0,
  });
  // Patients who haven't enrolled yet pick a method; everyone else uses theirs.
  const [choice, setChoice] = useState<TwoFactorMethod | null>(null);

  // The role and facility come from the profile, never from the URL.
  const finish = (p: TwoFactorProfile) => {
    setAuth(p.role, u, p.facilityId);
    // super_admin lives at /super-admin (the role id uses an underscore)
    (navigate as any)({ to: `/${p.role.replace("_", "-")}` });
  };

  const enrolling = !!profile && profile.method === null;
  // Staff always use the authenticator; only an enrolling patient chooses.
  const method: TwoFactorMethod | null = !profile
    ? null
    : (profile.method ?? (profile.role === "patient" ? choice : "totp"));

  const subtitle = isLoading
    ? "Checking your account…"
    : isError
      ? "We couldn't check your account"
      : !profile
        ? "Your sign-in session has ended"
        : method === null
          ? "Choose how you'd like to receive sign-in codes"
          : method === "sms"
            ? "We'll text a 6-digit code to your phone"
            : enrolling
              ? "Set up two-factor authentication for your account"
              : "Enter the 6-digit code from your authenticator app";

  return (
    <AuthBackground>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Two-factor authentication</h1>
          <p className="text-sm text-muted-foreground text-center mt-1">
            {subtitle}
          </p>
        </div>

        {isLoading ? null : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-center text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className={PRIMARY_BUTTON}
            >
              {isFetching ? "Checking…" : "Try again"}
            </button>
          </div>
        ) : !profile ? (
          <div className="space-y-3">
            <p className="text-sm text-center text-muted-foreground">
              Sign in again to continue.
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className={PRIMARY_BUTTON}
            >
              Sign in again
            </button>
          </div>
        ) : method === null ? (
          <MethodChoice onPick={setChoice} />
        ) : method === "sms" ? (
          <SmsCode onVerified={() => finish(profile)} canUseApp={enrolling} />
        ) : (
          <AuthenticatorCode
            storedSecret={profile.totpSecret}
            account={u}
            onVerified={() => finish(profile)}
          />
        )}

        {enrolling && profile.role === "patient" && method !== null && (
          <button
            type="button"
            onClick={() => setChoice(null)}
            className="w-full mt-4 text-sm text-[oklch(0.55_0.18_245)] hover:underline"
          >
            Choose a different method
          </button>
        )}

        {(isLoading || isError || !!profile) && (
          <button
            type="button"
            onClick={() => navigate({ to: "/login" })}
            className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        )}
      </div>
    </AuthBackground>
  );
}

/* ---------------- method choice (patients enrolling) ---------------- */

function MethodChoice({ onPick }: { onPick: (m: TwoFactorMethod) => void }) {
  const option = (
    m: TwoFactorMethod,
    Icon: typeof MessageSquare,
    title: string,
    body: string,
  ) => (
    <button
      type="button"
      onClick={() => onPick(m)}
      className="w-full flex items-start gap-3 text-left rounded-lg border p-4 hover:border-[oklch(0.55_0.18_245)] hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-[oklch(0.55_0.18_245)] outline-none transition"
    >
      <Icon
        size={20}
        className="mt-0.5 shrink-0 text-[oklch(0.55_0.18_245)]"
      />
      <span>
        <span className="block font-medium text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          {body}
        </span>
      </span>
    </button>
  );
  return (
    <div className="space-y-3">
      {option(
        "sms",
        MessageSquare,
        "Text message",
        "We'll send a code to the mobile number you registered with.",
      )}
      {option(
        "totp",
        Smartphone,
        "Authenticator app",
        "Use Google Authenticator, Microsoft Authenticator or Authy.",
      )}
    </div>
  );
}

/* ---------------- text-message code ---------------- */

function smsMessage(
  reason: SmsCodeFailure,
  extra: { retryAt?: number; attemptsLeft?: number },
  canUseApp: boolean,
): string {
  const orApp = canUseApp ? ", or use an authenticator app instead." : ".";
  switch (reason) {
    case "no-phone":
      return `We don't have a South African mobile number on your account. Ask clinic reception to update it${orApp}`;
    case "not-configured":
      return `Text message codes aren't available right now${
        canUseApp
          ? ". Use an authenticator app instead."
          : ". Contact the clinic for help."
      }`;
    case "not-eligible":
      return "Text message sign-in isn't available for this account.";
    case "unauthenticated":
      return "Your sign-in session has ended. Go back and sign in again.";
    case "cooldown":
      return "A code was sent recently. Enter it below, or request a new one when the timer ends.";
    case "rate-limited": {
      const retry = new Date(extra.retryAt ?? Date.now());
      // Some limits last a day: show the date too, or "08:00" reads as today.
      const when =
        retry.getTime() - Date.now() > 12 * 60 * 60_000
          ? retry.toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : retry.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
      return `Text-message codes are paused for this account. Try again after ${when}.`;
    }
    case "send-failed":
      return "We couldn't send the text message. Try again in a minute.";
    case "expired":
      return "That code has expired. Request a new one.";
    case "invalid-code":
      return extra.attemptsLeft != null
        ? `That code doesn't match. ${extra.attemptsLeft} ${
            extra.attemptsLeft === 1 ? "attempt" : "attempts"
          } left.`
        : "Enter the 6-digit code from the text message.";
    case "too-many-attempts":
      return "Too many incorrect attempts. Request a new code; if that's refused, try again tomorrow or ask the clinic to reset your sign-in.";
    case "busy":
      return "We couldn't process that just now. Try again in a moment.";
    default:
      return "Something went wrong. Try again.";
  }
}

function SmsCode({
  onVerified,
  canUseApp,
}: {
  onVerified: () => void;
  canUseApp: boolean;
}) {
  const [digits, setDigits] = useState(EMPTY);
  const [last4, setLast4] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const now = useTicker(resendAt > Date.now());

  // Nothing is sent until the user asks for a code.
  const send = async () => {
    setError("");
    setSending(true);
    try {
      const res = await sendSmsCode({
        data: { idToken: await currentIdToken() },
      });
      if (res.ok) {
        setLast4(res.phoneLast4);
        setResendAt(res.resendAt);
        setDigits(EMPTY);
      } else {
        if (res.reason === "cooldown" && res.retryAt) setResendAt(res.retryAt);
        // A code went out moments ago (e.g. before a page refresh), so let
        // them enter it.
        if (res.reason === "cooldown" && res.phoneLast4) setLast4(res.phoneLast4);
        setError(smsMessage(res.reason, res, canUseApp));
      }
    } catch {
      setError("Something went wrong sending the code. Try again.");
    } finally {
      setSending(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Enter all 6 digits");
      return;
    }
    setError("");
    setChecking(true);
    try {
      const res = await verifySmsCode({
        data: { idToken: await currentIdToken(), code },
      });
      if (res.ok) {
        onVerified();
        return;
      }
      setError(smsMessage(res.reason, res, canUseApp));
      setDigits(EMPTY);
    } catch {
      setError("Something went wrong checking the code. Try again.");
    } finally {
      setChecking(false);
    }
  };

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  if (last4 === null) {
    return (
      <div className="space-y-3">
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button
          type="button"
          onClick={send}
          disabled={sending || secondsLeft > 0}
          className={PRIMARY_BUTTON}
        >
          {sending
            ? "Sending…"
            : secondsLeft > 0
              ? `Text me a code (${secondsLeft}s)`
              : "Text me a code"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-5">
      <p className="text-sm text-center">
        We sent a code to the number ending in{" "}
        <strong className="font-mono">{last4}</strong>. It expires in 5
        minutes.
      </p>
      <CodeInput value={digits} onChange={setDigits} />
      {error && <p className="text-sm text-destructive text-center">{error}</p>}
      <button disabled={checking} className={PRIMARY_BUTTON}>
        {checking ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={send}
        disabled={sending || secondsLeft > 0}
        className="w-full text-sm text-[oklch(0.55_0.18_245)] hover:underline disabled:text-muted-foreground disabled:no-underline"
      >
        {sending
          ? "Sending…"
          : secondsLeft > 0
            ? `Resend code in ${secondsLeft}s`
            : "Resend code"}
      </button>
    </form>
  );
}

/** Current time, re-rendering every second while `active`. */
function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

/* ---------------- authenticator app ---------------- */

function AuthenticatorCode({
  storedSecret,
  account,
  onVerified,
}: {
  storedSecret: string | null;
  account: string;
  onVerified: () => void;
}) {
  const [digits, setDigits] = useState(EMPTY);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  // Enrolled users have a TOTP secret on their profile; first-time users enroll here.
  const enrolling = !storedSecret;
  const newSecret = useMemo(() => generateSecret(), []);
  const secret = storedSecret ?? newSecret;

  // Render the enrollment secret as a scannable QR code (same otpauth:// URI as
  // the manual key, so any authenticator app can scan instead of typing it).
  const [qrDataUrl, setQrDataUrl] = useState("");
  useEffect(() => {
    if (!enrolling) return;
    let alive = true;
    // qrcode is a Node-oriented package; import it lazily so it stays out of the
    // Cloudflare Workers SSR bundle and only loads in the browser.
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const url = await QRCode.toDataURL(
          otpauthUrl(secret, account || "zennith"),
          { width: 192, margin: 1 },
        );
        if (alive) setQrDataUrl(url);
      } catch {
        /* falls back to the manual key below */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enrolling, secret, account]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Enter all 6 digits");
      return;
    }
    setError("");
    setChecking(true);
    try {
      const ok = await verifyTotp(secret, code);
      if (!ok) {
        setError("Invalid code — check your authenticator app and try again.");
        setDigits(EMPTY);
        return;
      }
      // First valid code during enrollment activates 2FA for this account.
      if (enrolling) await saveTotpSecret(secret);
      onVerified();
    } catch (err) {
      console.error(err);
      setError("Couldn't finish setting up two-factor. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {enrolling && (
        <div className="mb-5 rounded-lg border bg-secondary/40 p-4 text-sm space-y-3">
          <p className="font-medium">
            1 · Scan this QR code with your authenticator app
          </p>
          <p className="text-xs text-muted-foreground">
            Open Google Authenticator (or Authy, Microsoft Authenticator…) →
            add account →<strong> Scan a QR code</strong>.
          </p>
          <div className="flex justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Two-factor setup QR code"
                width={192}
                height={192}
                className="rounded-md border bg-white p-2"
              />
            ) : (
              <div className="w-48 h-48 rounded-md border bg-white grid place-items-center text-xs text-muted-foreground">
                Generating QR…
              </div>
            )}
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground select-none">
              Can't scan? Enter the key manually
            </summary>
            <p className="mt-2">
              Add account → "Enter a setup key" for{" "}
              <strong>{account || "zennith"}</strong>:
            </p>
            <p className="font-mono text-center text-sm tracking-wider bg-white border rounded-md py-2 px-3 mt-1 select-all">
              {formatSecret(secret)}
            </p>
          </details>
          <p className="font-medium pt-1">
            2 · Enter the 6-digit code the app shows to finish setup
          </p>
        </div>
      )}

      <form onSubmit={verify} className="space-y-5">
        <CodeInput value={digits} onChange={setDigits} />
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <button disabled={checking} className={PRIMARY_BUTTON}>
          {checking
            ? "Verifying…"
            : enrolling
              ? "Activate & sign in"
              : "Verify"}
        </button>
      </form>
    </>
  );
}

/* ---------------- shared 6-digit input ---------------- */

function CodeInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus the first box whenever the code is cleared (first render, wrong code, resend).
  const empty = value.every((d) => d === "");
  useEffect(() => {
    if (empty) refs.current[0]?.focus();
  }, [empty]);

  const update = (i: number, v: string) => {
    // A pasted or autofilled code (e.g. from the text message) arrives whole
    // in one box: spread it across the boxes.
    if (/^\d{2,6}$/.test(v)) {
      const next = [...value];
      [...v].forEach((ch, k) => {
        if (i + k < 6) next[i + k] = ch;
      });
      onChange(next);
      refs.current[Math.min(i + v.length, 5)]?.focus();
      return;
    }
    if (v && !/^\d$/.test(v)) return;
    const next = [...value];
    next[i] = v;
    onChange(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center">
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => update(i, e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
            if (pasted.length < 2) return;
            e.preventDefault();
            update(i, pasted.slice(0, 6 - i));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0)
              refs.current[i - 1]?.focus();
          }}
          maxLength={i === 0 ? 6 : 1}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of 6`}
          className="w-11 h-12 text-center text-lg font-semibold border rounded-md focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] outline-none"
        />
      ))}
    </div>
  );
}
