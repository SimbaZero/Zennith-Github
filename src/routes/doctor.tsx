import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/doctor")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "doctor") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
