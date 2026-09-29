// Server-only: shared-secret checks for machine-to-machine endpoints.

/** The token from an `Authorization: Bearer <token>` header, if present. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match ? match[1].trim() : null;
}

/**
 * Compares a presented token with the configured secret in constant time, so
 * response timing doesn't reveal how many leading characters were right.
 */
export function tokenMatches(presented: string | null, secret: string): boolean {
  if (!presented) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(presented);
  const b = encoder.encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
