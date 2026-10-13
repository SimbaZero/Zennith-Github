import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bell, ChevronRight, ExternalLink } from "lucide-react";
import { Loading } from "@/components/Loading";
import type { Role } from "@/lib/auth";
import { markAllRead, markRead, type AppNotification } from "@/lib/notify";
import {
  describeLinkTarget,
  openNotification,
  parseNotificationLink,
} from "@/lib/notification-link";
import { useMyNotifications } from "@/lib/use-my-notifications";

function shortTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function fullTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The whole notifications list, with a detail pane to read one in full - the
 * bell's dropdown is for a glance, this is for reading. Which notification is
 * open is the page's `?n=` (so the browser's back button returns to the list,
 * and a link to one notification can be shared in the same session).
 *
 * Wide screens show the list and the detail side by side; narrow ones show one
 * at a time, with a way back to the list.
 */
export function NotificationsView({
  role,
  selectedId,
  onSelect,
}: {
  role: Role;
  selectedId?: string;
  onSelect: (docId: string | undefined) => void;
}) {
  const items = useMyNotifications(role);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  // The first snapshot hasn't arrived yet, as opposed to "there are none".
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (items.length > 0) setSettled(true);
  }, [items.length]);

  const unread = items.filter((i) => !i.isRead).length;
  const shown = useMemo(
    () => (filter === "unread" ? items.filter((i) => !i.isRead) : items),
    [items, filter],
  );
  const selected: AppNotification | undefined = items.find(
    (i) => i.docId === selectedId,
  );

  // Opening one reads it.
  const selectedDocId = selected?.docId;
  const selectedUnread = selected ? !selected.isRead : false;
  useEffect(() => {
    if (selectedDocId && selectedUnread) {
      markRead(selectedDocId).catch((e) =>
        console.error("Couldn't mark notification read:", e),
      );
    }
  }, [selectedDocId, selectedUnread]);

  const linkLabel = selected ? describeLinkTarget(selected.link) : "";
  const hasLink = selected ? !!parseNotificationLink(selected.link) : false;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(280px,380px)_1fr] items-start">
      {/* ---- the list ---- */}
      <section
        aria-label="All notifications"
        className={`rounded-xl border bg-white overflow-hidden ${selectedId ? "hidden md:block" : ""}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div className="flex gap-1" role="tablist">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs ${
                  filter === f
                    ? "bg-[oklch(0.18_0.06_260)] text-white"
                    : "border hover:bg-secondary"
                }`}
              >
                {f === "all" ? "All" : `Unread (${unread})`}
              </button>
            ))}
          </div>
          {unread > 0 && (
            <button
              onClick={() =>
                markAllRead(items.filter((i) => !i.isRead).map((i) => i.docId))
              }
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 && !settled ? (
          <p className="p-5 text-sm text-muted-foreground">
            <Loading label="Loading notifications" />
          </p>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center">
            <Bell
              size={28}
              className="mx-auto mb-2 text-muted-foreground/50"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              {filter === "unread"
                ? "Nothing unread."
                : "No notifications yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {shown.map((n) => (
              <li key={n.docId}>
                <button
                  onClick={() => onSelect(n.docId)}
                  aria-current={n.docId === selectedId ? "true" : undefined}
                  className={`flex w-full items-start gap-3 p-4 text-left hover:bg-secondary/40 ${
                    n.docId === selectedId
                      ? "bg-secondary/60"
                      : !n.isRead
                        ? "bg-[oklch(0.97_0.03_245)]"
                        : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                      n.isRead ? "bg-transparent" : "bg-[oklch(0.55_0.18_245)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${n.isRead ? "font-medium text-muted-foreground" : "font-semibold"}`}
                      >
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {shortTime(n.timeSent)}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {n.message}
                    </span>
                  </span>
                  <ChevronRight
                    size={14}
                    className="mt-1.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- one notification, in full ---- */}
      <section
        aria-label="Notification detail"
        className={`rounded-xl border bg-white ${selectedId ? "" : "hidden md:block"}`}
      >
        {!selectedId ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <Bell
              size={28}
              className="mx-auto mb-2 text-muted-foreground/50"
              aria-hidden
            />
            Choose a notification to read it in full.
          </div>
        ) : !selected ? (
          <div className="p-6">
            <button
              onClick={() => onSelect(undefined)}
              className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ArrowLeft size={14} /> All notifications
            </button>
            {settled ? (
              <p className="text-sm text-muted-foreground">
                That notification isn't available any more.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Loading label="Loading notification" />
              </p>
            )}
          </div>
        ) : (
          <article className="p-6" data-testid="notification-detail">
            <button
              onClick={() => onSelect(undefined)}
              className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ArrowLeft size={14} /> All notifications
            </button>
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {fullTime(selected.timeSent)}
            </p>
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
              {selected.message}
            </p>
            {hasLink && (
              <button
                onClick={() => openNotification(navigate, selected)}
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white hover:bg-[oklch(0.25_0.08_260)]"
              >
                <ExternalLink size={14} aria-hidden /> {linkLabel}
              </button>
            )}
          </article>
        )}
      </section>
    </div>
  );
}
