import { timingSafeEqual } from "node:crypto";
import { AuthenticationError, ConfigurationError, ValidationError, err, generateId, ok, type AppError, type Result, type UUID } from "@sport-os/shared";
import type { AuditService } from "./audit.js";
import { AuditOutcome } from "./audit.js";
import type { SupabaseClient } from "./db/client.js";
import type { PlatformSettingsRow } from "./db/types.js";
import type { UsersRepository } from "./identity.js";
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
  /** Read-only status check — informational only (e.g. "is bootstrap still available"). Never used as a concurrency gate; see claimAndPromoteOwner. */
  isOwnerBootstrapped(): Promise<boolean>;
  /**
   * Atomically claims the one-time OWNER bootstrap slot AND promotes
   * `userId` to OWNER, as a single coherent database-side operation —
   * never a prior isOwnerBootstrapped() read followed by a separate
   * write. Returns true only if THIS call performed the claim; false if
   * the slot was already claimed by a prior or concurrent call — a
   * deterministic "already done" signal. Guarantees: at most one caller
   * across all concurrent callers ever receives true, and a failure to
   * promote the target user never leaves the slot claimed with nobody
   * promoted (see the `claim_owner_bootstrap` Postgres function for the
   * real implementation's atomicity guarantee).
   */
  claimAndPromoteOwner(userId: UUID): Promise<boolean>;
}

/**
 * In-memory implementation for unit tests. `promote` mirrors the real
 * implementation's coherent claim-and-promote behavior — the JS
 * single-threaded event loop guarantees the check-then-set below runs
 * with no intervening await, so it faithfully models the atomicity the
 * real Postgres function provides via row-level locking.
 */
export class InMemoryPlatformSettingsRepository implements PlatformSettingsRepository {
  private bootstrappedAt: string | undefined;

  constructor(private readonly promote?: (userId: UUID) => Promise<void>) {}

  async isOwnerBootstrapped(): Promise<boolean> {
    return this.bootstrappedAt !== undefined;
  }

  async claimAndPromoteOwner(userId: UUID): Promise<boolean> {
    if (this.bootstrappedAt !== undefined) return false;
    this.bootstrappedAt = new Date().toISOString();
    await this.promote?.(userId);
    return true;
  }
}

/**
 * Real, Supabase-backed implementation. Only the service_role Postgres
 * role can reach platform_settings at all — see its RLS migration.
 * claimAndPromoteOwner delegates to the `claim_owner_bootstrap` SQL
 * function (see supabase/migrations/20260928121000_owner_bootstrap_atomic_claim.sql),
 * which performs the claim and the OWNER promotion inside one Postgres
 * transaction, race-safe via row-level locking on the conditional
 * UPDATE — never a SELECT-then-UPDATE pattern from this client.
 */
export class SupabasePlatformSettingsRepository implements PlatformSettingsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async isOwnerBootstrapped(): Promise<boolean> {
    const { data, error } = await this.client.from("platform_settings").select("owner_bootstrapped_at").eq("id", true).maybeSingle();
    if (error || !data) return false;
    return (data as Pick<PlatformSettingsRow, "owner_bootstrapped_at">).owner_bootstrapped_at !== null;
  }

  async claimAndPromoteOwner(userId: UUID): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_owner_bootstrap", { p_user_id: userId });
    if (error) {
      throw new ValidationError({ message: "Failed to claim owner bootstrap.", code: "OWNER_BOOTSTRAP_CLAIM_FAILED", context: { reason: error.message } });
    }
    return data === true;
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

  const user = await users.findByTelegramUserId(input.telegramUserId);
  if (!user) {
    return err(new ValidationError({ message: "The bootstrap target must have authenticated via Telegram first.", code: "OWNER_BOOTSTRAP_USER_NOT_FOUND" }));
  }

  // The atomic claim is the sole concurrency-sensitive step — deliberately
  // not preceded by an isOwnerBootstrapped() check, since that would
  // reintroduce the very read-then-write race this fixes. Exactly one
  // concurrent/later call can ever receive `true`.
  const claimed = await settings.claimAndPromoteOwner(user.id);
  if (!claimed) {
    return err(new AuthenticationError({ message: "Owner bootstrap has already run.", code: "OWNER_BOOTSTRAP_ALREADY_DONE" }));
  }

  const promoted = await users.findById(user.id);
  if (!promoted) {
    return err(new ValidationError({ message: "Owner bootstrap succeeded but the promoted user could not be re-read.", code: "OWNER_BOOTSTRAP_USER_NOT_FOUND" }));
  }

  try {
    await audit.record({
      actor: promoted.id,
      action: "owner_bootstrapped",
      resource: "user",
      resourceId: promoted.id,
      outcome: AuditOutcome.SUCCESS,
      requestId: generateId(),
      metadata: {},
    });
  } catch {
    // Best-effort: audit persistence failure must never hide or roll back
    // an already-committed, authoritative OWNER bootstrap claim.
  }

  return ok(promoted);
}
