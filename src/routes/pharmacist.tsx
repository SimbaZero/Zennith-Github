import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/pharmacist")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "pharmacist") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
