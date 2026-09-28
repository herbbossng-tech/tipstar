import { timingSafeEqual } from "node:crypto";
import { AuthenticationError, ConfigurationError, ValidationError, err, generateId, ok, type AppError, type Result, type UUID } from "@sport-os/shared";
import type { AuditService } from "./audit.js";
import { AuditOutcome } from "./audit.js";
import type { SupabaseClient } from "./db/client.js";
import type { PlatformSettingsRow } from "./db/types.js";
import type { UsersRepository } from "./identity.js";
import { Role } from "./license.js";
import type { AppUser } from "./roles.js";

/**
 * OWNER bootstrap (Section 03 — Owner Bootstrap). The one-time,
 * server-side-only, auditable path to establishing the platform's first
 * OWNER. Deliberately NOT automatic — there is no "first Telegram user
 * becomes OWNER" anywhere in this codebase, and no hard-coded Telegram
 * id. The caller must already have authenticated via Telegram (so a
 * users row exists for them) AND separately present a secret that only
 * exists outside the browser (OWNER_BOOTSTRAP_SECRET, server-only
 * config — see docs/environment-variables.md). The secret is compared
 * with a timing-safe comparison and is never logged or echoed back.
 */

export interface PlatformSettingsRepository {
  isOwnerBootstrapped(): Promise<boolean>;
  markOwnerBootstrapped(userId: UUID): Promise<void>;
}

/** In-memory implementation for unit tests. */
export class InMemoryPlatformSettingsRepository implements PlatformSettingsRepository {
  private bootstrappedAt: string | undefined;

  async isOwnerBootstrapped(): Promise<boolean> {
    return this.bootstrappedAt !== undefined;
  }

  async markOwnerBootstrapped(_userId: UUID): Promise<void> {
    this.bootstrappedAt = new Date().toISOString();
  }
}

/** Real, Supabase-backed implementation. Only the service_role Postgres role can reach platform_settings at all — see its RLS migration. */
export class SupabasePlatformSettingsRepository implements PlatformSettingsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async isOwnerBootstrapped(): Promise<boolean> {
    const { data, error } = await this.client.from("platform_settings").select("owner_bootstrapped_at").eq("id", true).maybeSingle();
    if (error || !data) return false;
    return (data as Pick<PlatformSettingsRow, "owner_bootstrapped_at">).owner_bootstrapped_at !== null;
  }

  async markOwnerBootstrapped(userId: UUID): Promise<void> {
    const { error } = await this.client.from("platform_settings").update({ owner_bootstrapped_at: new Date().toISOString(), owner_bootstrapped_user_id: userId }).eq("id", true);
    if (error) {
      throw new ValidationError({ message: "Failed to record owner bootstrap.", code: "OWNER_BOOTSTRAP_RECORD_FAILED", context: { reason: error.message } });
    }
  }
}

function timingSafeStringsEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export interface BootstrapOwnerInput {
  readonly telegramUserId: number;
  readonly providedSecret: string;
  /** Server-only config value (OWNER_BOOTSTRAP_SECRET). Undefined = bootstrap is unavailable — a safe, fail-closed default. */
  readonly configuredSecret: string | undefined;
}

export async function bootstrapOwner(
  users: UsersRepository,
  settings: PlatformSettingsRepository,
  audit: AuditService,
  input: BootstrapOwnerInput,
): Promise<Result<AppUser, AppError>> {
  if (!input.configuredSecret) {
    return err(new ConfigurationError({ message: "Owner bootstrap is not configured.", code: "OWNER_BOOTSTRAP_NOT_CONFIGURED" }));
  }
  if (!timingSafeStringsEqual(input.providedSecret, input.configuredSecret)) {
    return err(new AuthenticationError({ message: "Owner bootstrap secret is invalid.", code: "OWNER_BOOTSTRAP_SECRET_INVALID" }));
  }
  if (await settings.isOwnerBootstrapped()) {
    return err(new AuthenticationError({ message: "Owner bootstrap has already run.", code: "OWNER_BOOTSTRAP_ALREADY_DONE" }));
  }

  const user = await users.findByTelegramUserId(input.telegramUserId);
  if (!user) {
    return err(new ValidationError({ message: "The bootstrap target must have authenticated via Telegram first.", code: "OWNER_BOOTSTRAP_USER_NOT_FOUND" }));
  }

  const promoted = await users.updateRole(user.id, Role.OWNER);
  await settings.markOwnerBootstrapped(promoted.id);
  await audit.record({
    actor: promoted.id,
    action: "owner_bootstrapped",
    resource: "user",
    resourceId: promoted.id,
    outcome: AuditOutcome.SUCCESS,
    requestId: generateId(),
    metadata: {},
  });
  return ok(promoted);
}
