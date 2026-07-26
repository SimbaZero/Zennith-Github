// Minimal RFC 6238 TOTP implementation (SHA-1, 30s step, 6 digits) —
// compatible with Google Authenticator, Authy, Microsoft Authenticator, etc.

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // base32 encode
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new ArrayBuffer(8);
  new DataView(msg).setBigUint64(0, BigInt(counter));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = sig[sig.length - 1] & 0xf;
  const code =
    (((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Verify a 6-digit code against the secret, allowing ±1 time step (30s) of clock drift. */
export async function verifyTotp(secretB32: string, code: string, windowSteps = 1): Promise<boolean> {
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return false;
  const step = Math.floor(Date.now() / 30_000);
  const trimmed = code.trim();
  for (let w = -windowSteps; w <= windowSteps; w++) {
    if ((await hotp(secret, step + w)) === trimmed) return true;
  }
  return false;
}

/** otpauth:// URI — authenticator apps can import this directly. */
export function otpauthUrl(secretB32: string, account: string): string {
  return `otpauth://totp/Zennith:${encodeURIComponent(account)}?secret=${secretB32}&issuer=Zennith&algorithm=SHA1&digits=6&period=30`;
}

/** Format a secret in groups of 4 for manual entry. */
export function formatSecret(secretB32: string): string {
  return secretB32.replace(/(.{4})/g, "$1 ").trim();
}
