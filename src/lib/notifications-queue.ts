import { useEffect, useState } from "react";
import { loadLS, saveLS } from "./offline";

// Quiet hours: only DELIVER between 07:00 and 20:00 local time.
export const QUIET_START = 7; // 07:00
export const QUIET_END = 20; // 20:00 (8pm)

export type QueuedNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  scheduledFor: number; // ms epoch — earliest allowed delivery
  delivered: boolean;
};

const KEY = "zennith:notif-queue:v1";

function inWindow(d: Date) {
  const h = d.getHours();
  return h >= QUIET_START && h < QUIET_END;
}

/** Next allowed delivery time on/after `from` given quiet-hours window. */
export function nextAllowed(from: Date): Date {
  const d = new Date(from);
  if (inWindow(d)) return d;
  // Past 20:00 → next day at 07:00. Before 07:00 → same day 07:00.
  if (d.getHours() >= QUIET_END) d.setDate(d.getDate() + 1);
  d.setHours(QUIET_START, 0, 0, 0);
  return d;
}

export function loadQueue(): QueuedNotification[] {
  return loadLS<QueuedNotification[]>(KEY, []);
}
export function saveQueue(q: QueuedNotification[]) {
  saveLS(KEY, q);
}

export function enqueueNotification(input: { title: string; body: string; when?: Date }) {
  const now = new Date();
  const when = input.when ?? now;
  const scheduled = nextAllowed(when);
  const q = loadQueue();
  q.push({
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    body: input.body,
    createdAt: now.getTime(),
    scheduledFor: scheduled.getTime(),
    delivered: scheduled.getTime() <= now.getTime() && inWindow(now),
  });
  saveQueue(q);
  return q;
}

export function useQueuedNotifications(pollMs = 15_000) {
  const [q, setQ] = useState<QueuedNotification[]>([]);
  useEffect(() => {
    const flush = () => {
      const cur = loadQueue();
      const now = Date.now();
      let changed = false;
      for (const n of cur) {
        if (!n.delivered && n.scheduledFor <= now && inWindow(new Date(now))) {
          n.delivered = true;
          changed = true;
        }
      }
      if (changed) saveQueue(cur);
      setQ(cur);
    };
    flush();
    const id = setInterval(flush, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);
  return q;
}

export function clearDelivered() {
  saveQueue(loadQueue().filter((n) => !n.delivered));
}

export function removeNotification(id: string) {
  saveQueue(loadQueue().filter((n) => n.id !== id));
}
