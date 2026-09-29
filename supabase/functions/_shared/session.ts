// Shared session token issuance/verification for Supabase Edge Functions
// (Deno runtime). Mirrors packages/telegram/src/session.ts exactly —
// same stateless HMAC-signed token format (Section 02), same fields.
// Deno cannot import that npm workspace package directly, so this is a
// faithful reimplementation using Web Crypto; keep both in sync. See
// docs/architecture/TELEGRAM_AUTHENTICATION.md.

import { base64urlFromBytes, base64urlFromString, base64urlToString, hmacSha256, textEncoder, timingSafeEqualBytes } from "./crypto.ts";

export interface AuthSession {
  readonly sessionId: string;
  readonly telegramUserId: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authenticatedAt: string;
}

export interface IdentityForSession {
  readonly telegramUserId: number;
  readonly verifiedAt: string;
}

export interface IssuedAuthSession {
  readonly session: AuthSession;
  readonly token: string;
}

export async function issueAuthSession(identity: IdentityForSession, secret: string, ttlSeconds: number): Promise<IssuedAuthSession> {
  const now = new Date();
  const session: AuthSession = {
    sessionId: crypto.randomUUID(),
    telegramUserId: identity.telegramUserId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    authenticatedAt: identity.verifiedAt,
  };
  const payload = base64urlFromString(JSON.stringify(session));
  const signatureBytes = await hmacSha256(textEncoder.encode(secret), payload);
  return { session, token: `${payload}.${base64urlFromBytes(signatureBytes)}` };
}

export type VerifySessionResult = { ok: true; session: AuthSession } | { ok: false; code: string; message: string };

export async function verifyAuthSession(token: string, secret: string, now: Date = new Date()): Promise<VerifySessionResult> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, code: "SESSION_INVALID", message: "Session token is malformed." };
  }
  const [payload, signature] = parts as [string, string];

  const expectedSignatureBytes = await hmacSha256(textEncoder.encode(secret), payload);
  let signatureBytes: Uint8Array;
  try {
    const binary = base64urlToString(signature);
    signatureBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, code: "SESSION_INVALID", message: "Session token signature is malformed." };
  }
  if (!timingSafeEqualBytes(signatureBytes, expectedSignatureBytes)) {
    return { ok: false, code: "SESSION_INVALID", message: "Session token signature is invalid." };
  }

  let session: AuthSession;
  try {
    session = JSON.parse(base64urlToString(payload)) as AuthSession;
  } catch {
    return { ok: false, code: "SESSION_INVALID", message: "Session token payload could not be parsed." };
  }

  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: "SESSION_EXPIRED", message: "Session has expired." };
  }

  return { ok: true, session };
}
