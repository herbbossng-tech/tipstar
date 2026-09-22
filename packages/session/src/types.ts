import type { UUID } from "@tipstar/types";

/**
 * Claims carried by a Tipstar application session token. Issued only after
 * Telegram `initData` has been validated server-side (@tipstar/telegram).
 *
 * `role` and `tipstar_user_id` are read directly by Postgres RLS policies
 * via `tipstar_auth_user_id()` (see supabase/migrations) once this token is
 * presented to PostgREST as a bearer token — the claim names are a database
 * contract, not just an application convenience, and must not be renamed
 * without a matching migration change.
 */
export interface TipstarSessionClaims {
  /** Subject — the internal Tipstar user id. Mirrors tipstar_user_id. */
  readonly sub: UUID;
  /** Required by PostgREST/Supabase to treat this token as an authenticated request. */
  readonly role: "authenticated";
  readonly tipstar_user_id: UUID;
  readonly telegram_user_id: number;
  /** Issued-at, Unix seconds. */
  readonly iat: number;
  /** Expiry, Unix seconds. */
  readonly exp: number;
}

export interface IssuedSession {
  readonly accessToken: string;
  readonly tokenType: "bearer";
  /** ISO-8601 expiry timestamp, for client display/refresh scheduling only — the token itself is authoritative. */
  readonly expiresAt: string;
}
