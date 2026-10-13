// What someone types into the sign-in box, and which Firebase Auth e-mail(s) it
// could mean.
//
// An account's Firebase Auth e-mail is not one thing:
//   * the seeded/demo accounts were created as "<username>@zennith.test";
//   * accounts created from the admin screens use the person's REAL e-mail;
//   * profiles keep both a `username` and (usually) a contact `email`.
// So "type your username" only ever worked for the first kind, and "type your
// e-mail" only when it happened to be the Auth e-mail. The sign-in box takes
// either, and this works out the candidates to try.

export const TEST_DOMAIN = "zennith.test";
const MAX_CANDIDATES = 4;

/** Trimmed, lower-cased, and bounded: the form of an identifier used everywhere. */
export function normaliseIdentifier(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

/** Does this read as an e-mail address (as opposed to a username)? */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export interface LoginProfileHint {
  username?: unknown;
  email?: unknown;
  builtin?: unknown;
}

/**
 * The Auth e-mails to try for `identifier`, best guess first. `profiles` are the
 * profile documents matched by that username or e-mail (usually one, possibly
 * none). With none, this is exactly what the sign-in did before: an e-mail is
 * used as it is, a username becomes "<username>@zennith.test".
 */
export function loginCandidates(
  identifier: string,
  profiles: LoginProfileHint[] = [],
): string[] {
  const id = normaliseIdentifier(identifier);
  if (!id) return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== "string") return;
    const e = normaliseIdentifier(v);
    if (e && looksLikeEmail(e) && !out.includes(e)) out.push(e);
  };

  for (const p of profiles) {
    const username =
      typeof p.username === "string" ? normaliseIdentifier(p.username) : "";
    const synthetic = username ? `${username}@${TEST_DOMAIN}` : null;
    // A seeded account signs in under its synthetic address; one made from the
    // admin screens under its real e-mail. Try the likelier one first so a
    // normal sign-in is a single attempt.
    if (p.builtin === true) {
      add(synthetic);
      add(p.email);
    } else {
      add(p.email);
      add(synthetic);
    }
  }
  add(looksLikeEmail(id) ? id : `${id}@${TEST_DOMAIN}`);
  return out.slice(0, MAX_CANDIDATES);
}
