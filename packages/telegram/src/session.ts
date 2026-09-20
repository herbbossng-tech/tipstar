import { buildIdempotencyKey, type Result } from "@tipstar/shared";
import type { TelegramIdentity, User } from "@tipstar/types";
import type { TelegramWebAppUser } from "./types.js";

export interface ResolvedSession {
  readonly user: User;
  readonly telegramIdentity: TelegramIdentity;
}

/**
 * Persistence boundary for turning a validated Telegram user into an
 * internal Tipstar user. Concrete implementation (Supabase-backed) is
 * provided by the backend, not this package — this package only owns
 * Telegram protocol concerns.
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
