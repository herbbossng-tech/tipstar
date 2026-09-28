import { createHmac, timingSafeEqual } from "node:crypto";
import { generateId, AuthenticationError, err, ok, type ISODateString, type Result } from "@sport-os/shared";
import type { AuthenticatedTelegramIdentity } from "./types.js";

/**
 * AuthSession (Section 02 — Session Architecture). Section 01
 * deliberately deferred all persistence to Section 03, so this is NOT a
 * database-backed session: it's a stateless, HMAC-signed token — "the
 * cleanest secure boundary" available without inventing persistent
 * storage this section shouldn't own. See
 * docs/architecture/TELEGRAM_AUTHENTICATION.md for the full rationale
 * and what Section 03 is expected to add (a real revocable session store
 * if one is ever needed).
 */
export interface AuthSession {
  readonly sessionId: string;
  readonly telegramUserId: number;
  readonly issuedAt: ISODateString;
  readonly expiresAt: ISODateString;
  readonly authenticatedAt: ISODateString;
}

export interface IssuedAuthSession {
  readonly session: AuthSession;
  /** Opaque, signed. The only thing the client should treat as a bearer credential — never the raw AuthSession fields. */
  readonly token: string;
}

function base64url(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

/**
 * Issues a signed session for a just-verified Telegram identity. Callers
 * must never persist raw initData in the session — only the already
 * distilled identity fields defined by AuthSession.
 */
export function issueAuthSession(identity: AuthenticatedTelegramIdentity, secret: string, ttlSeconds: number, now: Date = new Date()): IssuedAuthSession {
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const session: AuthSession = {
    sessionId: generateId(),
    telegramUserId: identity.telegramUserId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    authenticatedAt: identity.verifiedAt,
  };
  const payload = base64url(JSON.stringify(session));
  const signature = sign(payload, secret);
  return { session, token: `${payload}.${signature}` };
}

/** Verifies a token issued by issueAuthSession: signature and expiry. Never trust a session's claims without calling this first. */
export function verifyAuthSession(token: string, secret: string, now: Date = new Date()): Result<AuthSession, AuthenticationError> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return err(new AuthenticationError({ message: "Session token is malformed.", code: "SESSION_INVALID" }));
  }
  const [payload, signature] = parts as [string, string];

  const expectedSignature = sign(payload, secret);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  const signatureValid = signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!signatureValid) {
    return err(new AuthenticationError({ message: "Session token signature is invalid.", code: "SESSION_INVALID" }));
  }

  let session: AuthSession;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
  } catch {
    return err(new AuthenticationError({ message: "Session token payload could not be parsed.", code: "SESSION_INVALID" }));
  }

  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return err(new AuthenticationError({ message: "Session has expired.", code: "SESSION_EXPIRED" }));
  }

  return ok(session);
}
