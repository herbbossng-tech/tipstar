import type { AuthSessionStore, PersistedAuthSessionInput } from "@sport-os/telegram";
import { ValidationError } from "@sport-os/shared";
import type { SupabaseClient } from "./client.js";
import type { AuthSessionRow } from "./types.js";

/**
 * Real, Supabase-backed implementation of @sport-os/telegram's
 * AuthSessionStore (Section 03). Service-role only — auth_sessions has
 * no INSERT/UPDATE/DELETE policy for any other Postgres role, by design.
 */
export class SupabaseAuthSessionStore implements AuthSessionStore {
  constructor(private readonly client: SupabaseClient) {}

  async persist(input: PersistedAuthSessionInput): Promise<void> {
    const { error } = await this.client.from("auth_sessions").insert({
      user_id: input.userId,
      session_id: input.session.sessionId,
      token_hash: input.tokenHash,
      issued_at: input.session.issuedAt,
      expires_at: input.session.expiresAt,
    });
    if (error) {
      throw new ValidationError({ message: "Failed to persist session.", code: "SESSION_PERSIST_FAILED", context: { reason: error.message } });
    }
  }

  async isRevoked(sessionId: string, tokenHash: string): Promise<boolean> {
    const { data, error } = await this.client.from("auth_sessions").select("token_hash, revoked_at, expires_at").eq("session_id", sessionId).maybeSingle();
    if (error || !data) return true;
    const row = data as Pick<AuthSessionRow, "token_hash" | "revoked_at" | "expires_at">;
    if (row.token_hash !== tokenHash) return true;
    if (row.revoked_at !== null) return true;
    if (new Date(row.expires_at).getTime() <= Date.now()) return true;
    return false;
  }

  async revoke(sessionId: string, reason?: string): Promise<void> {
    const { error } = await this.client
      .from("auth_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason ?? null })
      .eq("session_id", sessionId);
    if (error) {
      throw new ValidationError({ message: "Failed to revoke session.", code: "SESSION_REVOKE_FAILED", context: { reason: error.message } });
    }
  }

  async revokeAllForUser(userId: string, reason?: string): Promise<void> {
    const { error } = await this.client
      .from("auth_sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason ?? null })
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (error) {
      throw new ValidationError({ message: "Failed to revoke sessions.", code: "SESSION_REVOKE_ALL_FAILED", context: { reason: error.message } });
    }
  }
}
