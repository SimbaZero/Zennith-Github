// What a notification's `link` means, and how to act on it.
//
// A notification should be a way IN: clicking it takes you to the thing it is
// about. Links are stored as plain strings in the notification document, in
// the form "/page", "/page#section", "/page?date=2026-10-14#appt-12" - so they
// are split here into what the router needs.
//
// Notification documents are writable by any signed-in user, so a link is never
// trusted as-is: only a path inside this app is followed.

import { jumpToSection } from "@/lib/jump-to-section";

export interface LinkTarget {
  to: string;
  search?: Record<string, string>;
  hash?: string;
}

/** The in-app destination a stored link points at, or null if it isn't one. */
export function parseNotificationLink(
  link: string | undefined | null,
): LinkTarget | null {
  if (typeof link !== "string") return null;
  // A clinic request used to have a page of its own; notifications written
  // then still point there. It is now a section of All Staff.
  const raw =
    link.trim() === "/admin/requests"
      ? "/admin/staff?requests=1#clinic-requests"
      : link.trim();
  // One leading slash only: "//host" and "https://host" would leave the app.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw)) {
    return null;
  }
  const [beforeHash, ...hashParts] = raw.split("#");
  const hash = hashParts.join("#");
  const [path, query] = beforeHash.split("?");
  if (!path || path.length > 200) return null;

  const search: Record<string, string> = {};
  if (query) {
    for (const [key, value] of new URLSearchParams(query)) {
      if (key) search[key] = value;
    }
  }
  return {
    to: path,
    ...(Object.keys(search).length ? { search } : {}),
    ...(hash ? { hash } : {}),
  };
}

/** A short label for the button that follows a link ("View appointment"). */
export function describeLinkTarget(link: string | undefined | null): string {
  const target = parseNotificationLink(link);
  if (!target) return "";
  const { to, hash } = target;
  if (to === "/admin/staff" && hash === "clinic-requests")
    return "Review clinic requests";
  if (/\/appointments$/.test(to)) return "View appointment";
  if (to === "/patient/medical-record") return "View medical record";
  if (to === "/patient/alerts") return "Open alerts";
  if (to === "/patient/privacy") return "Open privacy settings";
  if (to === "/patient" && hash === "medication-reminders")
    return "View medication reminders";
  if (to === "/nurse/stock") return "View stock";
  if (to === "/pharmacist/deliveries") return "View deliveries";
  if (to === "/pharmacist/analytics") return "View medication overview";
  if (to === "/receptionist/queue") return "Open the queue";
  if (/\/audit$/.test(to)) return "View audit log";
  return "Open";
}

/** Where to go for a notification that has no link of its own: its detail page. */
export function notificationDetailTarget(docId: string): LinkTarget {
  return { to: "/notifications", search: { n: docId } };
}

/**
 * Follows a notification: to the page (and section) its link names, or to its
 * own detail page when it has none. Shared by the bell and the full list.
 * `navigate` is the router's navigate function.
 */
export function openNotification(
  navigate: unknown,
  n: { docId: string; link?: string },
): void {
  const target =
    parseNotificationLink(n.link) ?? notificationDetailTarget(n.docId);
  (
    navigate as (opts: {
      to: string;
      search?: Record<string, string>;
      hash?: string;
    }) => void
  )({ to: target.to, search: target.search, hash: target.hash });
  // "/page#section" goes to the page AND scrolls to (and briefly highlights)
  // that section.
  if (target.hash) jumpToSection(target.hash);
}
