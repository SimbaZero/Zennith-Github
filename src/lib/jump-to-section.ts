// ---------------------------------------------------------------------------
// Scroll to a section of the current page and make it obvious which one.
//
// A notification should be a way IN, not just an announcement. Clicking one
// used to navigate to its page — but when you were already on that page (a
// reminder about a card on the dashboard, clicked from the dashboard) nothing
// visibly happened at all.
//
// The section often does not exist yet when this is called: the page is still
// loading the data it draws from. So this keeps looking for it briefly rather
// than giving up after one try.
// ---------------------------------------------------------------------------

/**
 * Fired at the element a jump lands on. A collapsible section listens for it on
 * itself and opens, so a notification that points at a closed section lands on
 * its contents rather than on a toggle.
 */
export const OPEN_SECTION_EVENT = "zennith:open-section";

/** A ring that fades in and out. Written out in full so Tailwind sees it. */
const FLASH_CLASSES = ["ring-4", "ring-amber-300", "ring-offset-2"];

export function jumpToSection(
  id: string,
  options: { tries?: number; intervalMs?: number; flashMs?: number } = {},
): () => void {
  const { tries = 30, intervalMs = 150, flashMs = 2600 } = options;
  if (typeof document === "undefined") return () => {};

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  const attempt = () => {
    if (cancelled) return;
    const el = document.getElementById(id);
    if (el) {
      el.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT));
      // Scroll a moment later, so a section that just opened has its contents.
      const reveal = () => {
        if (cancelled) return;
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        el.classList.add(...FLASH_CLASSES);
        timer = setTimeout(() => {
          el.classList.remove(...FLASH_CLASSES);
        }, flashMs);
      };
      timer = setTimeout(reveal, 30);
      return;
    }
    attempts += 1;
    if (attempts < tries) timer = setTimeout(attempt, intervalMs);
  };

  timer = setTimeout(attempt, 50);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
