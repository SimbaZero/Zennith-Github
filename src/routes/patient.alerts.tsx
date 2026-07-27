import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  useCurrentPatient,
  usePatientNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/patient-service";
import {
  enqueueNotification,
  useQueuedNotifications,
  removeNotification,
  QUIET_START,
  QUIET_END,
} from "@/lib/notifications-queue";
import { useOnline } from "@/lib/offline";
import { Wifi, WifiOff, BellOff, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/patient/alerts")({ component: Alerts });

function Alerts() {
  const { patient } = useCurrentPatient();
  const items = usePatientNotifications(patient?.userId);
  const unread = items.filter((i) => !i.isRead).length;
  const online = useOnline();
  const queued = useQueuedNotifications();
  const delivered = queued.filter((q) => q.delivered);
  const pending = queued.filter((q) => !q.delivered);

  const scheduleReminder = () => {
    enqueueNotification({
      title: "Medication reminder",
      body: "Take your evening TLD dose with water.",
    });
    toast.success("Reminder queued — quiet hours 07:00–20:00 respected");
  };

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
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border bg-white text-muted-foreground">
          <Clock size={12} /> Quiet hours:{" "}
          {String(QUIET_START).padStart(2, "0")}:00–
          {String(QUIET_END).padStart(2, "0")}:00
        </span>
        <button
          onClick={scheduleReminder}
          className="ml-auto text-xs border px-3 py-1.5 rounded-md hover:bg-secondary"
        >
          Queue medication reminder
        </button>
      </div>

      {pending.length > 0 && (
        <div className="bg-[oklch(0.98_0.03_85)] border border-[oklch(0.85_0.14_85)] rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <BellOff size={14} className="text-[oklch(0.5_0.17_85)]" />
            <p className="text-sm font-semibold text-[oklch(0.4_0.17_85)]">
              {pending.length} held until quiet hours end
            </p>
          </div>
          <ul className="text-xs space-y-1 text-[oklch(0.45_0.15_85)]">
            {pending.slice(0, 3).map((p) => (
              <li key={p.id}>
                · {p.title} — deliver at{" "}
                {new Date(p.scheduledFor).toLocaleTimeString("en-ZA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center justify-between">
          <h3 className="font-semibold">{unread + delivered.length} unread</h3>
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
          {delivered.map((d) => (
            <div
              key={d.id}
              className="w-full text-left flex gap-3 p-4 bg-[oklch(0.98_0.04_245)]"
            >
              <div className="w-2 h-2 rounded-full mt-2 bg-[oklch(0.6_0.18_245)]" />
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="text-sm font-semibold">{d.title}</span>
                  <button
                    onClick={() => removeNotification(d.id)}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    dismiss
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{d.body}</p>
              </div>
            </div>
          ))}
          {items.length === 0 && delivered.length === 0 && (
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
