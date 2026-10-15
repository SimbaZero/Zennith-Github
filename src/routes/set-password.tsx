import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";
import { Loading, Spinner } from "@/components/Loading";
import {
  MIN_INVITE_PASSWORD_LENGTH,
  completePatientInvite,
  describeLinkFailure,
  previewPatientInvite,
  type InvitePreview,
} from "@/lib/patient-invite";

// Where the link in a patient's text message / e-mail lands. Reception sends it
// after registering the patient at the desk; choosing a password here creates
// the patient's sign-in account (see src/server/patient-invite.ts).
export const Route = createFileRoute("/set-password")({
  validateSearch: (search: Record<string, unknown>): { t: string } => ({
    t: typeof search.t === "string" ? search.t : "",
  }),
  component: SetPassword,
});

function SetPassword() {
  const { t: token } = Route.useSearch();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneAs, setDoneAs] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    previewPatientInvite({ data: { token } })
      .then((p) => !cancelled && setPreview(p))
      .catch(
        () => !cancelled && setPreview({ ok: false, reason: "server-error" }),
      );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_INVITE_PASSWORD_LENGTH) {
      setError(describeLinkFailure("weak-password"));
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await completePatientInvite({ data: { token, password } });
      if (result.ok) setDoneAs(result.username);
      else setError(describeLinkFailure(result.reason));
    } catch {
      setError(describeLinkFailure("server-error"));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]";

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Set your password</h1>
        </div>

        {doneAs ? (
          <div
            className="text-center space-y-4"
            data-testid="set-password-done"
          >
            <p className="text-sm">
              Your password is set. You can sign in now with:
            </p>
            <p className="font-mono font-semibold bg-secondary rounded-md px-3 py-2 break-all">
              {doneAs}
            </p>
            <p className="text-xs text-muted-foreground">
              Type that into the sign-in box, with the password you just chose.
            </p>
            <Link
              to="/login"
              className="inline-block bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm"
            >
              Go to sign in
            </Link>
          </div>
        ) : preview == null ? (
          <p className="text-sm text-muted-foreground text-center">
            <Loading label="Checking your link" />
          </p>
        ) : !preview.ok ? (
          <div
            className="text-center space-y-4"
            data-testid="set-password-problem"
          >
            <p className="text-sm text-muted-foreground">
              {describeLinkFailure(preview.reason)}
            </p>
            <Link
              to="/login"
              className="inline-block bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Hello {preview.firstName}. Choose a password for your Zennith
              patient account.
            </p>
            <div className="rounded-md border bg-secondary/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                You will sign in with:{" "}
              </span>
              <span className="font-mono font-semibold break-all">
                {preview.username}
              </span>
            </div>
            <div>
              <label
                htmlFor="new-password"
                className="text-sm font-medium block mb-1.5"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_INVITE_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label
                htmlFor="confirm-password"
                className="text-sm font-medium block mb-1.5"
              >
                Type it again
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={input}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-[oklch(0.5_0.2_25)]">
                {error}
              </p>
            )}
            <button
              disabled={busy}
              className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Spinner />}
              {busy ? "Setting password…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </AuthBackground>
  );
}
