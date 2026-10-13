import { useEffect, useRef } from "react";
import { notifyUser } from "@/lib/notify";

// A notification when a suggested reorder or delivery first appears - and not
// again and again while it stays unresolved.
//
// The rule, in terms of someone's visits to the Deliveries page:
//   - when a suggestion appears while the page is open (or is already there when
//     it opens), they are told once;
//   - re-renders, data refreshes and further suggestions that were already
//     announced during the same stay never repeat it;
//   - if it is still unresolved the next time they open the page, it is
//     announced once more - once per return visit, not once per minute.
//
// "A stay" is one mount of the page, so the memory of what was announced lives in
// the component, and a fresh visit starts with a clean slate.

export type SuggestionKind = "supplier-order" | "clinic-delivery";

export interface SuggestionGroup {
  kind: SuggestionKind;
  /** The things now suggested, each with a stable key and a name to show. */
  items: { key: string; label: string }[];
  title: string;
  /** The sentence, given the names of the newly suggested ones. */
  message: (labels: string[]) => string;
  link: string;
}

/**
 * Two mounts of the page a moment apart (a dev double-mount, or a quick
 * back-and-forth) are one visit as far as the person is concerned, so a repeat
 * within this window is ignored. Module-level so it survives a remount.
 */
const SAME_VISIT_MS = 5_000;
const recentlyAnnounced = new Map<string, number>();

/** The items not yet announced, given the set already announced this stay. */
export function unannounced(
  announced: ReadonlySet<string>,
  items: { key: string; label: string }[],
): { key: string; label: string }[] {
  return items.filter((i) => !announced.has(i.key));
}

/**
 * Tells `userId` about each group's suggestions that haven't been announced yet
 * this stay. Waits for `ready` (the stock, usage and open orders have loaded),
 * so a half-loaded page can't announce something that is about to disappear.
 */
export function useSuggestionAlerts(input: {
  ready: boolean;
  userId: number | undefined;
  /** Distinguishes one clinic's suggestions from another's. */
  scope: string;
  groups: SuggestionGroup[];
}): void {
  const announced = useRef(new Set<string>());
  // Sorted, so the effect runs when the SET of suggestions changes and not
  // when an equal list is rebuilt on every render.
  const signature = input.groups
    .map(
      (g) =>
        `${g.kind}:${g.items
          .map((i) => i.key)
          .sort()
          .join(",")}`,
    )
    .join("|");
  const groupsRef = useRef(input.groups);
  groupsRef.current = input.groups;

  useEffect(() => {
    if (!input.ready || input.userId == null) return;
    const now = Date.now();
    for (const g of groupsRef.current) {
      const fresh = unannounced(
        announced.current,
        g.items.map((i) => ({
          key: `${input.scope}:${g.kind}:${i.key}`,
          label: i.label,
        })),
      );
      if (fresh.length === 0) continue;
      for (const f of fresh) announced.current.add(f.key);
      // Ones announced a moment ago by an earlier mount of the page (a dev
      // double-mount, a quick back-and-forth) are the same visit.
      const toTell = fresh.filter((f) => {
        const last = recentlyAnnounced.get(`${input.userId}:${f.key}`);
        recentlyAnnounced.set(`${input.userId}:${f.key}`, now);
        return last == null || now - last >= SAME_VISIT_MS;
      });
      if (toTell.length === 0) continue;
      // Fire-and-forget: a notification must never get in the page's way.
      void notifyUser({
        userId: input.userId,
        title: g.title,
        message: g.message(toTell.map((f) => f.label)),
        link: g.link,
      }).catch((err) => console.error("Suggestion alert failed:", err));
    }
    // `signature` stands in for the groups' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.ready, input.userId, input.scope, signature]);
}
