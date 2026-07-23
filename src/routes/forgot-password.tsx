import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ZennithStar } from "@/components/ZennithStar";
import { AuthBackground } from "@/components/AuthBackground";

export const Route = createFileRoute("/forgot-password")({ component: Forgot });

function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <AuthBackground videoSrc="/login-bg.mp4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <ZennithStar size={64} spin />
          <h1 className="mt-3 text-xl font-bold">Reset your password</h1>
        </div>
        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email}</strong>, a reset link has been sent.
            </p>
            <Link to="/login" className="inline-block bg-[oklch(0.18_0.06_260)] text-white px-4 py-2 rounded-md text-sm">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div>
              <label className="text-sm font-medium block mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
              />
            </div>
            <button className="w-full bg-[oklch(0.18_0.06_260)] text-white py-2.5 rounded-md font-medium hover:bg-[oklch(0.25_0.08_260)]">
              Send reset link
            </button>
            <Link to="/login" className="block text-sm text-center text-muted-foreground hover:text-foreground">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </AuthBackground>
  );
}
