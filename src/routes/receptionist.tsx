import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

export const Route = createFileRoute("/receptionist")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && getAuth() !== "receptionist") {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
