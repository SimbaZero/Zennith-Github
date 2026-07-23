import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/patient")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "patient") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
