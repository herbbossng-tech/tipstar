import { createHash } from "node:crypto";
import { AuthenticationError, err, type Result } from "@sport-os/shared";
import { verifyAuthSession, type AuthSession } from "./session.js";

/**
 * Session persistence layer (Section 03 — Session Architecture
 * decision). Purely additive to Section 02: `issueAuthSession()` and
 * `verifyAuthSession()` in session.ts are untouched — this module wraps
 * them with a revocation check backed by a store, rather than replacing
 * them. See docs/architecture/TELEGRAM_AUTHENTICATION.md's "Session
 * architecture (Section 03 update)" for the full rationale (hybrid:
 * stateless signature verification stays the first, fast check; a store
 * lookup is the second, revocation-capable check).
 */

export interface PersistedAuthSessionInput {
  readonly userId: string;
  readonly session: AuthSession;
  readonly tokenHash: string;
}

export interface AuthSessionStore {
  persist(input: PersistedAuthSessionInput): Promise<void>;
  /** True if the session is unknown, its token hash doesn't match (defense in depth against a forged sessionId), or it has been explicitly revoked/expired in the store. Fails closed: "not found" is treated as revoked, never as "allow". */
  isRevoked(sessionId: string, tokenHash: string): Promise<boolean>;
  revoke(sessionId: string, reason?: string): Promise<void>;
  revokeAllForUser(userId: string, reason?: string): Promise<void>;
}

interface StoredSession {
  readonly userId: string;
  readonly tokenHash: string;
  revoked: boolean;
}

/** In-memory implementation for fast unit tests — real logic, no network. */
export class InMemoryAuthSessionStore implements AuthSessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async persist(input: PersistedAuthSessionInput): Promise<void> {
    this.sessions.set(input.session.sessionId, { userId: input.userId, tokenHash: input.tokenHash, revoked: false });
  }

  async isRevoked(sessionId: string, tokenHash: string): Promise<boolean> {
    const record = this.sessions.get(sessionId);
    if (!record) return true;
    if (record.tokenHash !== tokenHash) return true;
    return record.revoked;
  }

  async revoke(sessionId: string, _reason?: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record) record.revoked = true;
  }

  async revokeAllForUser(userId: string, _reason?: string): Promise<void> {
    for (const record of this.sessions.values()) {
      if (record.userId === userId) record.revoked = true;
    }
  }
}

/** SHA-256 hex digest of a session token. NEVER store the raw token itself — only this. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The real Section 03 verification entry point: Section 02's
 * verifyAuthSession() (signature + expiry) followed by a store-backed
 * revocation check. Prefer this over calling verifyAuthSession()
 * directly wherever a persistent store is available (the Node/Deno
 * server paths); verifyAuthSession() alone remains correct and
 * unchanged for anything that only needs stateless verification.
 */
export async function verifyAuthSessionWithRevocation(
  token: string,
  secret: string,
  store: AuthSessionStore,
  now: Date = new Date(),
): Promise<Result<AuthSession, AuthenticationError>> {
  const verified = verifyAuthSession(token, secret, now);
  if (!verified.ok) return verified;

  const revoked = await store.isRevoked(verified.value.sessionId, hashSessionToken(token));
  if (revoked) {
    return err(new AuthenticationError({ message: "Session has been revoked.", code: "SESSION_REVOKED" }));
  }
  return verified;
}
