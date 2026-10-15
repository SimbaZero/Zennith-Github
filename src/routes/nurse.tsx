import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";
import { RequireRole } from "@/components/RequireRole";

export const Route = createFileRoute("/nurse")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "nurse") {
      throw redirect({ to: "/login" });
    }
  },
  // beforeLoad only runs on in-app navigation; RequireRole covers a direct
  // visit, where nothing protected may render before the session is checked.
  component: () => (
    <RequireRole role="nurse">
      <Outlet />
    </RequireRole>
  ),
});
