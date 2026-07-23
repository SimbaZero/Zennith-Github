import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/nurse")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "nurse") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
