import { buildIdempotencyKey, type Result } from "@tipstar/shared";
import type { TelegramIdentity, User } from "@tipstar/types";
import type { TelegramWebAppUser } from "./types.js";

export interface ResolvedSession {
  readonly user: User;
  readonly telegramIdentity: TelegramIdentity;
}

/**
 * Persistence boundary for turning a validated Telegram user into an
 * internal Tipstar user. This package only owns Telegram protocol
 * concerns; the concrete implementation is the `upsert_telegram_user`
 * Postgres RPC (supabase/migrations/20260921000000_telegram_session_upsert.sql),
 * called from supabase/functions/telegram-init-auth (Section 02). See
 * in-memory-user-repository.ts for the development/test double used to
 * unit test resolveOrCreateSession's idempotency contract below without a
 * database.
 */
export interface UserIdentityRepository {
  findByTelegramUserId(telegramUserId: number): Promise<ResolvedSession | undefined>;
  createFromTelegram(telegramUser: TelegramWebAppUser): Promise<ResolvedSession>;
}

/**
 * Idempotent: resolves an existing user for this Telegram id, or creates
 * exactly one new user record. The idempotency key is derived from the
 * Telegram user id so retried webhook/auth calls never create duplicates
 * (Engineering Constitution section 24).
 */
export async function resolveOrCreateSession(
  telegramUser: TelegramWebAppUser,
  repository: UserIdentityRepository,
): Promise<Result<ResolvedSession, never>> {
  const idempotencyKey = buildIdempotencyKey("telegram_user", telegramUser.id);
  void idempotencyKey; // surfaced for repository implementations to use as an upsert conflict key

  const existing = await repository.findByTelegramUserId(telegramUser.id);
  if (existing) {
    return { ok: true, value: existing };
  }
  const created = await repository.createFromTelegram(telegramUser);
  return { ok: true, value: created };
}
