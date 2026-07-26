import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import { setAuth, fetchTotpSecret, saveTotpSecret, type Role } from "@/lib/auth";
import { generateSecret, verifyTotp, otpauthUrl, formatSecret } from "@/lib/totp";

export const Route = createFileRoute("/two-factor")({
  validateSearch: (s: Record<string, unknown>) => {
    const allowed: Role[] = [
      "doctor", "nurse", "patient", "pharmacist", "receptionist", "admin", "super_admin",
    ];
    const r = allowed.includes(s.role as Role) ? (s.role as Role) : "nurse";
    const username = typeof s.u === "string" ? (s.u as string) : "";
    // facility (clinic) the user is signing in to; empty for super_admin/patient
    const facility = typeof s.f === "string" ? (s.f as string) : "";
    return { role: r, u: username, f: facility };
  },
  component: TwoFactor,
});

function TwoFactor() {
  const { role, u, f } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Enrolled users have a TOTP secret on their profile; first-time users enroll here.
  const { data: storedSecret, isLoading } = useQuery({
    queryKey: ["totp-secret", u],
    queryFn: fetchTotpSecret,
  });
  const enrolling = !isLoading && !storedSecret;
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
        const url = await QRCode.toDataURL(otpauthUrl(secret, u || "zennith"), { width: 192, margin: 1 });
        if (alive) setQrDataUrl(url);
      } catch {
        /* falls back to the manual key below */
      }
    })();
    return () => { alive = false; };
  }, [enrolling, secret, u]);

  const update = (i: number, v: string) => {
    if (v && !/^\d$/.test(v)) return;
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
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
      const ok = await verifyTotp(secret, code);
      if (!ok) {
        setError("Invalid code — check your authenticator app and try again.");
        setDigits(["", "", "", "", "", ""]);
        refs.current[0]?.focus();
        return;
      }
      // First valid code during enrollment activates 2FA for this account.
      if (enrolling) await saveTotpSecret(secret);
      setAuth(role, u, f || null);
      // super_admin lives at /super-admin (the role id uses an underscore)
      (navigate as any)({ to: `/${role.replace("_", "-")}` });
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthBackground>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Two-factor authentication</h1>
          <p className="text-sm text-muted-foreground text-center mt-1">
            {enrolling
              ? "Set up two-factor authentication for your account"
              : "Enter the 6-digit code from your authenticator app"}
          </p>
        </div>

        {enrolling && (
          <div className="mb-5 rounded-lg border bg-secondary/40 p-4 text-sm space-y-3">
            <p className="font-medium">1 · Scan this QR code with your authenticator app</p>
            <p className="text-xs text-muted-foreground">
              Open Google Authenticator (or Authy, Microsoft Authenticator…) → add account →
              <strong> Scan a QR code</strong>.
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
                Add account → "Enter a setup key" for <strong>{u || "zennith"}</strong>:
              </p>
              <p className="font-mono text-center text-sm tracking-wider bg-white border rounded-md py-2 px-3 mt-1 select-all">
                {formatSecret(secret)}
              </p>
            </details>
            <p className="font-medium pt-1">2 · Enter the 6-digit code the app shows to finish setup</p>
          </div>
        )}

        <form onSubmit={verify} className="space-y-5">
          <div className="flex gap-2 justify-center">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { refs.current[i] = el; }}
                value={d}
                onChange={(e) => update(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
                }}
                maxLength={1}
                inputMode="numeric"
                className="w-11 h-12 text-center text-lg font-semibold border rounded-md focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] outline-none"
              />
            ))}
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <button
            disabled={checking || isLoading}
            className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60"
          >
            {isLoading ? "Loading…" : checking ? "Verifying…" : enrolling ? "Activate & sign in" : "Verify"}
          </button>
          <button
            type="button"
            onClick={() => navigate({ to: "/login" })}
            className="w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        </form>
      </div>
    </AuthBackground>
  );
}
