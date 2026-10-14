// Shared by the demo-data scripts: what a demo person's e-mail address looks
// like. Always on the reserved zennith.test domain (the same one the demo
// accounts use: doctor@zennith.test), always valid, never a real inbox.

/** The domain every demo address uses. */
export const DEMO_DOMAIN = "zennith.test";

/** Letters and digits only, lower-case, accents folded: "Van der Merwe" -> "vandermerwe". */
export function slug(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The shape every e-mail address stored in the app must have. */
export function isValidEmail(raw: unknown): boolean {
  return typeof raw === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/** Whether an address is on the demo domain (so it can't be a real person's inbox). */
export function isDemoAddress(raw: unknown): boolean {
  return (
    typeof raw === "string" &&
    raw.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`)
  );
}

/**
 * A demo address for a person: firstname.lastname@zennith.test. `taken` holds
 * addresses already in use (lower-case); on a clash the user number is added
 * so every person still gets a different address.
 */
export function demoEmailFor(
  person: { names?: unknown; surname?: unknown; userId?: unknown },
  taken: Set<string>,
): string {
  const first = slug(person.names);
  const last = slug(person.surname);
  const base =
    [first, last].filter(Boolean).join(".") || `user${slug(person.userId)}`;
  let candidate = `${base}@${DEMO_DOMAIN}`;
  if (taken.has(candidate))
    candidate = `${base}.${slug(person.userId)}@${DEMO_DOMAIN}`;
  return candidate;
}

/**
 * Repairs an address that is already on the demo domain but not valid, by
 * removing what made it invalid (spaces, punctuation) and keeping the rest, so
 * "sipho.van der merwe90102@zennith.test" becomes
 * "sipho.vandermerwe90102@zennith.test" and stays unique.
 */
export function repairDemoAddress(raw: string): string {
  const at = raw.lastIndexOf("@");
  const local = (at === -1 ? raw : raw.slice(0, at))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${local || "user"}@${DEMO_DOMAIN}`;
}
