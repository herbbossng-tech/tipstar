import { generateId } from "@tipstar/shared";
import { UserRole, UserStatus, type TelegramIdentity, type User } from "@tipstar/types";
import type { ResolvedSession, UserIdentityRepository } from "./session.js";
import type { TelegramWebAppUser } from "./types.js";

/**
 * DEVELOPMENT/TEST-ONLY in-memory UserIdentityRepository, mirroring the
 * pattern in @tipstar/picks and @tipstar/settlement. Exists so
 * `resolveOrCreateSession` (idempotent upsert semantics) can be unit
 * tested without a database. The Supabase-backed equivalent is the
 * `upsert_telegram_user` RPC (supabase/migrations), called from
 * supabase/functions/telegram-init-auth.
 */
export class InMemoryUserIdentityRepository implements UserIdentityRepository {
  private readonly byTelegramUserId = new Map<number, ResolvedSession>();
  createCallCount = 0;

  async findByTelegramUserId(telegramUserId: number): Promise<ResolvedSession | undefined> {
    return this.byTelegramUserId.get(telegramUserId);
  }

  async createFromTelegram(telegramUser: TelegramWebAppUser): Promise<ResolvedSession> {
    this.createCallCount += 1;
    const now = new Date().toISOString();
    const userId = generateId();
    const user: User = {
      id: userId,
      status: UserStatus.ACTIVE,
      roles: [UserRole.USER],
      languageCode: telegramUser.language_code ?? null,
      createdAt: now,
      lastActiveAt: now,
    };
    const telegramIdentity: TelegramIdentity = {
      userId,
      telegramUserId: telegramUser.id,
      telegramUsername: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null,
      isPremium: telegramUser.is_premium ?? null,
      linkedAt: now,
    };
    const resolved: ResolvedSession = { user, telegramIdentity };
    this.byTelegramUserId.set(telegramUser.id, resolved);
    return resolved;
  }
}
