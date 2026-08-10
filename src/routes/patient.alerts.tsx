import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/patient-service";
import { useOnline } from "@/lib/offline";
import { Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/alerts")({ component: Alerts });

function Alerts() {
  const { patient } = useCurrentPatient();
  const items = usePatientNotifications(patient?.userId);
  const unread = items.filter((i) => !i.isRead).length;
  const online = useOnline();

  const markOneRead = async (docId: string) => {
    try {
      await markNotificationRead(docId);
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark as read");
    }
  };

  const markAllRead = async () => {
    try {
      const unreadIds = items.filter((i) => !i.isRead).map((i) => i.docId);
      await markAllNotificationsRead(unreadIds);
    } catch (err) {
      console.error(err);
      toast.error("Failed to mark all as read");
    }
  };

  return (
    <AppShell role="patient" title="Notifications & Alerts">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${online ? "bg-[oklch(0.97_0.06_160)] text-[oklch(0.4_0.15_160)]" : "bg-[oklch(0.97_0.05_60)] text-[oklch(0.45_0.17_60)]"}`}
        >
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          {online ? "Online" : "Offline — changes will sync"}
        </span>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-semibold">{unread} unread</h3>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs border px-3 py-1.5 rounded-md hover:bg-secondary"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="divide-y">
          {items.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">
              No notifications.
            </p>
          )}
          {items.map((a) => (
            <button
              key={a.docId}
              onClick={() => markOneRead(a.docId)}
              className={`w-full text-left flex gap-3 p-4 hover:bg-secondary/30 ${!a.isRead ? "bg-[oklch(0.97_0.05_245)]" : ""}`}
            >
              <div className="w-2 h-2 rounded-full mt-2 bg-[oklch(0.6_0.18_245)]" />
              <div className="flex-1">
                <div className="flex justify-between">
                  <span
                    className={`text-sm ${!a.isRead ? "font-semibold" : "font-medium text-muted-foreground"}`}
                  >
                    {a.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.timeSent).toLocaleString("en-ZA", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {a.message}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
