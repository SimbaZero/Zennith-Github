import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import { setAuth, type Role } from "@/lib/auth";
import { logAction } from "@/lib/audit";

export const Route = createFileRoute("/two-factor")({
  validateSearch: (s: Record<string, unknown>) => {
    const allowed: Role[] = ["doctor", "nurse", "patient", "pharmacist", "receptionist", "admin", "super_admin"];
    const r = allowed.includes(s.role as Role) ? (s.role as Role) : "nurse";
    const username = typeof s.u === "string" ? (s.u as string) : "";
    const f = typeof s.f === "string" ? (s.f as string) : "";
    return { role: r, u: username, f };
  },
  component: TwoFactor,
});

function TwoFactor() {
  const { role, u, f } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const update = (i: number, v: string) => {
    if (v && !/^\d$/.test(v)) return;
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Enter all 6 digits");
      return;
    }
    setAuth(role, u, f || null);
    logAction({ facility_id: f || null, actor_id: u || role, action_type: "auth.login", description: `User "${u || role}" signed in as ${role}` });
    const dest = role === "super_admin" ? "/super-admin" : `/${role}`;
    (navigate as any)({ to: dest });
  };

  return (
    <AuthBackground>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Two-factor authentication</h1>
          <p className="text-sm text-muted-foreground text-center mt-1">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>
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
          <p className="text-xs text-center text-muted-foreground">Demo: any 6 digits will verify</p>
          <button className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)]">
            Verify
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
