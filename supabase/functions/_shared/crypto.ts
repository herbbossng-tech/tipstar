// Shared Web Crypto helpers for Supabase Edge Functions (Deno runtime).
// Deno's standard, documented convention for code shared between
// functions is a `_shared/` directory imported via relative paths — see
// https://supabase.com/docs/guides/functions/import-maps. Used by both
// telegram-auth and me so the HMAC/hashing primitives exist in exactly
// one place, never duplicated and risking drift between them.

const textEncoder = new TextEncoder();

export async function hmacSha256(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return new Uint8Array(signature);
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Constant-time byte comparison — an ordinary `===` would leak timing
// information about how many leading bytes matched.
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlFromString(value: string): string {
  return base64urlFromBytes(textEncoder.encode(value));
}

export function base64urlToString(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (UTF-8 byte length must match first, or it's an immediate non-match — same shape as node:crypto's timingSafeEqual requirement). */
export function timingSafeStringsEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  return timingSafeEqualBytes(aBytes, bBytes);
}

export { textEncoder };
