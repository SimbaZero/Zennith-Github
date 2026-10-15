import { Loader2 } from "lucide-react";

// One loading indicator for the whole app, so "still working on it" looks the
// same everywhere instead of being a different line of grey text on each page.
//
// `Spinner` is the bare animation, for tight spots (inside a button, beside a
// value). `Loading` is the spinner with a short label, for filling an empty
// area such as a list or table that hasn't arrived yet. The label stays in the
// DOM so screen readers still hear what is loading, and so the spinner is never
// an unexplained circle.

export function Spinner({
  size = 16,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  /** Accessible name when used on its own. Omit when a visible label sits beside it. */
  label?: string;
}) {
  return (
    <Loader2
      size={size}
      // motion-safe: people who ask their device for less motion get a still ring.
      className={`shrink-0 motion-safe:animate-spin ${className}`}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function Loading({
  label = "Loading",
  size = 16,
  className = "",
  /** Hide the words and show only the spinner (the words stay for screen readers). */
  iconOnly = false,
}: {
  label?: string;
  size?: number;
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-muted-foreground ${className}`}
    >
      <Spinner size={size} />
      <span className={iconOnly ? "sr-only" : undefined}>{label}…</span>
    </span>
  );
}
