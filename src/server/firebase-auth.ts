// Server-only: verifies Firebase Auth ID tokens, the proof a browser sends of
// who is signed in. firebase-admin can't run on Workers, so this makes the
// checks its verifyIdToken makes: an RS256 signature from one of Google's
// rotating securetoken keys, plus the issuer, audience and timing claims for
// this Firebase project.
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
// Tolerance for a token issued by a server whose clock is slightly ahead.
// Expiry gets none: an expired token is rejected, as Firebase specifies.
const CLOCK_SKEW_S = 60;
// An unknown key ID triggers a refetch (Google rotates keys), but at most
// this often, so made-up key IDs can't make every request fetch keys.
const FORCED_REFRESH_MS = 60_000;

let keyCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;
let lastForcedRefresh = 0;

async function signingKeys(forceRefresh = false): Promise<Map<string, CryptoKey>> {
  if (keyCache && keyCache.expiresAt > Date.now() && !forceRefresh) return keyCache.keys;

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Fetching Firebase signing keys failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> };

  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys ?? []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    );
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  keyCache = { keys: imported, expiresAt: Date.now() + maxAge * 1000 };
  return imported;
}

/** The uid in a valid, unexpired Firebase ID token for `projectId`, or null. */
export async function verifyIdToken(idToken: unknown, projectId: string): Promise<string | null> {
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) return null;

  let header: { alg?: unknown; kid?: unknown };
  let claims: { iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; iat?: unknown; auth_time?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== `https://securetoken.google.com/${projectId}` || claims.aud !== projectId) return null;
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_S) return null;
  if (typeof claims.auth_time !== "number" || claims.auth_time > now + CLOCK_SKEW_S) return null;

  let keys = await signingKeys();
  if (!keys.has(header.kid) && Date.now() - lastForcedRefresh > FORCED_REFRESH_MS) {
    lastForcedRefresh = Date.now();
    keys = await signingKeys(true);
  }
  const key = keys.get(header.kid);
  if (!key) return null;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64UrlDecode(parts[2]);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return valid ? claims.sub : null;
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
