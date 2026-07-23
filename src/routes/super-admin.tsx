import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/super-admin")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "super_admin") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
