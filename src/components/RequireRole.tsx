import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getAuth, type Role } from "@/lib/auth";
import { Loading } from "@/components/Loading";

// Guards a whole portal (/admin, /nurse, …) against a signed-out visitor.
//
// The routes' `beforeLoad` redirect only runs on in-app navigation: a direct
// visit to the URL is rendered by the server (which can't see the browser's
// session) and the browser then adopts that page without running `beforeLoad`
// again, so the portal used to appear, and start loading its data, before
// anything redirected.
//
// So the portal's content is never rendered until the browser has checked the
// session. The server, and the browser's first render, both produce only the
// neutral loading line below; after mounting, a matching session shows the
// portal and anything else is sent to the sign-in page.
export function RequireRole({
  role,
  children,
}: {
  /** The role this portal is for. Omit to accept any signed-in role. */
  role?: Role;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "allowed" | "denied">(
    "checking",
  );

  useEffect(() => {
    const current = getAuth();
    setState(current && (!role || current === role) ? "allowed" : "denied");
  }, [role]);

  useEffect(() => {
    if (state === "denied") void navigate({ to: "/login", replace: true });
  }, [state, navigate]);

  if (state !== "allowed") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        <Loading
          label={state === "denied" ? "Redirecting to sign in" : "Loading"}
        />
      </div>
    );
  }
  return <>{children}</>;
}
