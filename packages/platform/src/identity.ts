import { NotImplementedError, ValidationError, generateId, type ISODateString, type UUID } from "@sport-os/shared";
import type { AuthenticatedTelegramIdentity } from "@sport-os/telegram";
import type { SupabaseClient } from "./db/client.js";
import type { UserRow } from "./db/types.js";
import { UserStatus, type AppUser } from "./roles.js";
import { Role } from "./license.js";

/**
 * Internal identity anchored to a Telegram user (Section 01 — Licensing
 * Foundation). The Telegram user id is an identity ANCHOR, not a secret —
 * it is safe to see in the frontend. It is never, by itself, treated as
 * authenticated: `IdentityService.resolve` only returns an Identity after
 * the caller has already validated the Telegram initData signature (see
 * @sport-os/telegram's validateInitData) — server-side verification is
 * the actual security boundary, per Security Principle 3.
 */
export interface Identity {
  readonly userId: UUID;
  readonly telegramUserId: number;
  readonly telegramUsername: string | undefined;
  readonly createdAt: ISODateString;
}

/**
 * IdentityService — resolves a validated Telegram user into an internal
 * Identity. `NotImplementedIdentityService` remains for callers that
 * have not migrated; `DatabaseIdentityService` (below) is the real,
 * persisted implementation Section 03 adds.
 */
export interface IdentityService {
  resolve(telegramUserId: number): Promise<Identity | undefined>;
  resolveOrCreate(telegramUserId: number, telegramUsername: string | undefined): Promise<Identity>;
}

export class NotImplementedIdentityService implements IdentityService {
  async resolve(_telegramUserId: number): Promise<Identity | undefined> {
    throw new NotImplementedError("IdentityService.resolve");
  }
  async resolveOrCreate(_telegramUserId: number, _telegramUsername: string | undefined): Promise<Identity> {
    throw new NotImplementedError("IdentityService.resolveOrCreate");
  }
}

// ============================================================
// Users repository + real IdentityService (Section 03)
// ============================================================

function userRowToDomain(row: UserRow): AppUser {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    username: row.username ?? undefined,
    firstName: row.first_name,
    lastName: row.last_name ?? undefined,
    languageCode: row.language_code ?? undefined,
    isPremium: row.is_premium,
    role: row.role as Role,
    status: row.status as UserStatus,
    lastAuthenticatedAt: row.last_authenticated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UsersRepository {
  findByTelegramUserId(telegramUserId: number): Promise<AppUser | undefined>;
  findById(userId: UUID): Promise<AppUser | undefined>;
  /** Insert-or-update-safe-profile-fields by telegram_user_id — see upsertAuthenticatedTelegramUser(). Never accepts role/status/createdBy. */
  upsertFromTelegram(input: {
    readonly telegramUserId: number;
    readonly username: string | undefined;
    readonly firstName: string;
    readonly lastName: string | undefined;
    readonly languageCode: string | undefined;
    readonly isPremium: boolean;
    readonly authenticatedAt: ISODateString;
  }): Promise<AppUser>;
  updateRole(userId: UUID, role: Role): Promise<AppUser>;
  updateStatus(userId: UUID, status: UserStatus): Promise<AppUser>;
}

/** In-memory implementation for fast unit tests — real logic, no network, mirroring InMemoryAgentRegistry/InMemoryAuditService. */
export class InMemoryUsersRepository implements UsersRepository {
  private readonly users = new Map<UUID, AppUser>();

  async findByTelegramUserId(telegramUserId: number): Promise<AppUser | undefined> {
    for (const user of this.users.values()) {
      if (user.telegramUserId === telegramUserId) return user;
    }
    return undefined;
  }

  async findById(userId: UUID): Promise<AppUser | undefined> {
    return this.users.get(userId);
  }

  async upsertFromTelegram(input: {
    readonly telegramUserId: number;
    readonly username: string | undefined;
    readonly firstName: string;
    readonly lastName: string | undefined;
    readonly languageCode: string | undefined;
    readonly isPremium: boolean;
    readonly authenticatedAt: ISODateString;
  }): Promise<AppUser> {
    const existing = await this.findByTelegramUserId(input.telegramUserId);
    const now = new Date().toISOString();
    const user: AppUser = {
      id: existing?.id ?? generateId(),
      telegramUserId: input.telegramUserId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      languageCode: input.languageCode,
      isPremium: input.isPremium,
      role: existing?.role ?? Role.USER,
      status: existing?.status ?? UserStatus.ACTIVE,
      lastAuthenticatedAt: input.authenticatedAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateRole(userId: UUID, role: Role): Promise<AppUser> {
    const existing = this.users.get(userId);
    if (!existing) throw new ValidationError({ message: "User not found.", code: "USER_NOT_FOUND" });
    const updated = { ...existing, role, updatedAt: new Date().toISOString() };
    this.users.set(userId, updated);
    return updated;
  }

  async updateStatus(userId: UUID, status: UserStatus): Promise<AppUser> {
    const existing = this.users.get(userId);
    if (!existing) throw new ValidationError({ message: "User not found.", code: "USER_NOT_FOUND" });
    const updated = { ...existing, status, updatedAt: new Date().toISOString() };
    this.users.set(userId, updated);
    return updated;
  }
}

const USER_COLUMNS = "id, telegram_user_id, username, first_name, last_name, language_code, is_premium, role, status, last_authenticated_at, created_at, updated_at";

/**
 * Real, Supabase-backed repository (Section 03). Constructed with a
 * service-role client — bypasses RLS, so every caller must have already
 * authorized the operation (upsertFromTelegram is only ever called right
 * after a successful Section 02 Telegram validation; updateRole/
 * updateStatus are only ever called from the authorization-checked admin
 * operations in user-admin.ts).
 */
export class SupabaseUsersRepository implements UsersRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByTelegramUserId(telegramUserId: number): Promise<AppUser | undefined> {
    const { data, error } = await this.client.from("users").select(USER_COLUMNS).eq("telegram_user_id", telegramUserId).maybeSingle();
    if (error || !data) return undefined;
    return userRowToDomain(data as UserRow);
  }

  async findById(userId: UUID): Promise<AppUser | undefined> {
    const { data, error } = await this.client.from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
    if (error || !data) return undefined;
    return userRowToDomain(data as UserRow);
  }

  async upsertFromTelegram(input: {
    readonly telegramUserId: number;
    readonly username: string | undefined;
    readonly firstName: string;
    readonly lastName: string | undefined;
    readonly languageCode: string | undefined;
    readonly isPremium: boolean;
    readonly authenticatedAt: ISODateString;
  }): Promise<AppUser> {
    // Upsert on telegram_user_id only ever writes the safe profile columns
    // below — role/status/id are never part of this payload, so a
    // conflicting update can never touch them (see the ON CONFLICT
    // clause: only these columns are in the update list).
    const { data, error } = await this.client
      .from("users")
      .upsert(
        {
          telegram_user_id: input.telegramUserId,
          username: input.username ?? null,
          first_name: input.firstName,
          last_name: input.lastName ?? null,
          language_code: input.languageCode ?? null,
          is_premium: input.isPremium,
          last_authenticated_at: input.authenticatedAt,
        },
        { onConflict: "telegram_user_id" },
      )
      .select(USER_COLUMNS)
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to upsert Telegram-authenticated user.", code: "USER_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return userRowToDomain(data as UserRow);
  }

  async updateRole(userId: UUID, role: Role): Promise<AppUser> {
    const { data, error } = await this.client.from("users").update({ role }).eq("id", userId).select(USER_COLUMNS).single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to update user role.", code: "ROLE_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return userRowToDomain(data as UserRow);
  }

  async updateStatus(userId: UUID, status: UserStatus): Promise<AppUser> {
    const { data, error } = await this.client.from("users").update({ status }).eq("id", userId).select(USER_COLUMNS).single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to update user status.", code: "STATUS_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return userRowToDomain(data as UserRow);
  }
}

/** Real, database-backed IdentityService (Section 03). */
export class DatabaseIdentityService implements IdentityService {
  constructor(private readonly users: UsersRepository) {}

  async resolve(telegramUserId: number): Promise<Identity | undefined> {
    const user = await this.users.findByTelegramUserId(telegramUserId);
    if (!user) return undefined;
    return { userId: user.id, telegramUserId: user.telegramUserId, telegramUsername: user.username, createdAt: user.createdAt };
  }

  async resolveOrCreate(telegramUserId: number, telegramUsername: string | undefined): Promise<Identity> {
    const user = await this.users.upsertFromTelegram({
      telegramUserId,
      username: telegramUsername,
      firstName: "",
      lastName: undefined,
      languageCode: undefined,
      isPremium: false,
      authenticatedAt: new Date().toISOString(),
    });
    return { userId: user.id, telegramUserId: user.telegramUserId, telegramUsername: user.username, createdAt: user.createdAt };
  }
}

/**
 * The single, canonical bridge from a Section 02 server-verified Telegram
 * identity to a persisted application user (Section 03 — Authentication
 * → Database Identity). This is the ONLY function that may create or
 * update a `users` row from Telegram-sourced data.
 *
 * Guarantees, by construction (see UsersRepository.upsertFromTelegram's
 * implementations — the payload literally has no role/status/id/
 * createdBy fields to set):
 *   1. Only ever called with an identity Section 02 already verified
 *      server-side — this function does not itself touch initData.
 *   2. Looks up by telegram_user_id, creates if absent.
 *   3. Updates only safe profile fields (username/first_name/last_name/
 *      language_code/is_premium/last_authenticated_at) when changed.
 *   4-7. The identity payload has no way to specify role, license
 *      status, or entitlements — new users always default to Role.USER
 *      (enforced by both UsersRepository implementations and, for the
 *      Supabase-backed one, the users table's own DEFAULT 'user' and the
 *      enforce_user_self_service_boundaries trigger).
 *   8. The identity payload has no created_by field either — that
 *      concept applies to licenses (who granted this license), not users.
 */
export async function upsertAuthenticatedTelegramUser(users: UsersRepository, identity: AuthenticatedTelegramIdentity): Promise<AppUser> {
  return users.upsertFromTelegram({
    telegramUserId: identity.telegramUserId,
    username: identity.username,
    firstName: identity.firstName,
    lastName: identity.lastName,
    languageCode: identity.languageCode,
    isPremium: identity.isPremium ?? false,
    authenticatedAt: identity.verifiedAt,
  });
}
