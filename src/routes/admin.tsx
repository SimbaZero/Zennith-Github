import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "admin") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
