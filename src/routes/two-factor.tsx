import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import {
  setAuth,
  fetchTwoFactorProfile,
  saveTotpSecret,
  currentIdToken,
  type TwoFactorProfile,
} from "@/lib/auth";

import {
  generateSecret,
  verifyTotp,
  otpauthUrl,
  formatSecret,
} from "@/lib/totp";
import { logAction } from "@/lib/audit";

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

// ---------------------------------------------------------------------------
// DEVELOPER SHORTCUT — local testing only.
//
// When VITE_DEV_2FA_BYPASS is "true", this screen shows a "Skip (dev only)"
// button that signs in without a code. It skips only this client-side step: the
// password has already been verified by Firebase Auth, the role and facility
// still come from the signed-in user's own profile, and nothing in
// firestore.rules or on the server is relaxed.
//
// It is never silent: a bypass is logged as auth.login_dev_bypass (deliberately
// not auth.login_success), and a red banner is shown for as long as it's active.
//
// The variable is read at BUILD time, and Vite reads .env for production builds
// too — so a .env on the machine that builds the deployed bundle would bake it
// in. To make that harmless, the bypass is also refused unless the page is being
// served from this machine or a private network address. A deployed site is
// never on one, so a flag that slips into a production build does nothing there.
// ---------------------------------------------------------------------------
const DEV_2FA_BYPASS_FLAG = import.meta.env.VITE_DEV_2FA_BYPASS === "true";

/** localhost, loopback, *.local, and the private IPv4 ranges (a phone on the LAN). */
function isLocalAddress(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local"))
    return true;
  if (h === "[::1]" || h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

/** Is the bypass on? Decided after mount, since it depends on the address bar. */
function useDevBypass(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!DEV_2FA_BYPASS_FLAG) return;
    if (isLocalAddress(window.location.hostname)) {
      setOn(true);
    } else {
      console.warn(
        "VITE_DEV_2FA_BYPASS is set in this build but is being ignored: " +
          "this page isn't served from a local or private address.",
      );
    }
  }, []);
  return on;
}

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
  // The role and facility come from the profile, never from the URL.
  const devBypass = useDevBypass();
  const finish = (p: TwoFactorProfile, opts?: { devBypass?: boolean }) => {
    setAuth(p.role, u, p.facilityId);
    // A completed login: password/SMS code and second factor both accepted —
    // or, for the developer shortcut, skipped. A bypass is recorded as its own
    // action type and NOT as a success, so it can never pass for a normal login
    // in the audit log.
    logAction({
      clinicId: null,
      actor_id: u || "unknown",
      action_type: opts?.devBypass
        ? "auth.login_dev_bypass"
        : "auth.login_success",
      description: opts?.devBypass
        ? `"${u || "unknown"}" signed in as ${p.role} with the DEV 2FA bypass — no code was entered`
        : `"${u || "unknown"}" signed in as ${p.role}`,
    });
    // super_admin lives at /super-admin (the role id uses an underscore)
    (navigate as any)({ to: `/${p.role.replace("_", "-")}` });
  };

  // The authenticator app is the only second factor, for every role.
  const enrolling = !!profile && profile.method === null;

  const subtitle = isLoading
    ? "Checking your account…"
    : isError
      ? "We couldn't check your account"
      : !profile
        ? "Your sign-in session has ended"
        : enrolling
          ? profile.smsRetired
            ? "Text-message codes are no longer available. Set up an authenticator app to keep signing in"
            : "Set up two-factor authentication for your account"
          : "Enter the 6-digit code from your authenticator app";

  return (
    <AuthBackground>
      {devBypass && (
        // role="status", not "alert": this is a notice that a mode is on, not an
        // error, and should be announced as politely as it looks.
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 border-b border-amber-200 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-stone-800"
        >
          Demo mode — skip verification for testing purposes.
        </div>
      )}
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
        ) : (
          <AuthenticatorCode
            storedSecret={profile.totpSecret}
            account={u}
            onVerified={() => finish(profile)}
          />
        )}

        {devBypass && profile && (
          <button
            type="button"
            onClick={() => finish(profile, { devBypass: true })}
            className="w-full mt-4 rounded-md border border-gray-300 bg-white py-2.5 font-medium text-gray-700 hover:bg-gray-50"
          >
            Continue without a code (demo)
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
        // A real sign-in attempt that failed after the password was accepted —
        // logged fire-and-forget (logAction never blocks or throws). clinicId
        // is null on purpose: login events are a platform-level record, and a
        // clinic id would put every login into that clinic admin's own audit
        // list. Only the username goes in — never the code or the secret.
        logAction({
          clinicId: null,
          actor_id: account || "unknown",
          action_type: "auth.login_failed",
          description: `Failed sign-in for "${account || "unknown"}": wrong two-factor code`,
        });
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
            Open Google Authenticator (or Authy, Microsoft Authenticator…) → add
            account →<strong> Scan a QR code</strong>.
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
        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}
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
