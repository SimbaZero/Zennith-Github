import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Loading } from "@/components/Loading";
import { NotificationsView } from "@/components/NotificationsView";
import { getAuth, type Role } from "@/lib/auth";

// One notifications page for every role: the bell's dropdown is a glance, this
// is where a notification is read in full. (Patients' own page is /patient/alerts,
// which also carries the "you're being called" card.)
export const Route = createFileRoute("/notifications")({
  validateSearch: (s: Record<string, unknown>): { n?: string } =>
    typeof s.n === "string" && s.n ? { n: s.n } : {},
  beforeLoad: () => {
    if (typeof window !== "undefined" && !getAuth()) {
      throw redirect({ to: "/login" });
    }
  },
  component: NotificationsPage,
});

function NotificationsPage() {
  const { n } = Route.useSearch();
  const navigate = useNavigate();
  // The session role lives in the browser, so it's read after mounting.
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => setRole(getAuth()), []);

  if (!role) {
    return (
      <p className="p-10 text-center text-sm text-muted-foreground">
        <Loading label="Loading notifications" />
      </p>
    );
  }
  return (
    <AppShell role={role} title="Notifications">
      <NotificationsView
        role={role}
        selectedId={n}
        onSelect={(docId) =>
          navigate({
            to: "/notifications",
            search: docId ? { n: docId } : {},
          })
        }
      />
    </AppShell>
  );
}
