// Small UI helpers shared by the signup and clinic-registration forms. Kept
// separate from the components in FormField.tsx so that file only exports
// components (which is what hot reloading needs).

const BASE_INPUT =
  "w-full px-3 py-2.5 border rounded-md outline-none focus:ring-2";

/** Input styling. Turns red when the field has an error. */
export function inputClass(hasError: boolean, extra = ""): string {
  const tone = hasError
    ? "border-destructive focus:ring-destructive"
    : "focus:ring-[oklch(0.55_0.18_245)]";
  return `${BASE_INPUT} ${tone} ${extra}`.trim();
}

/** Scrolls to and focuses the first field (in page order) that has an error. */
export function focusFirstError(
  order: string[],
  errors: Partial<Record<string, string>>,
  idPrefix: string,
): void {
  const first = order.find((key) => errors[key]);
  if (!first) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(`${idPrefix}-${first}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  });
}
