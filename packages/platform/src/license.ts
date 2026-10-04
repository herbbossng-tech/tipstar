import { AuthorizationError, NotImplementedError, ValidationError, err, generateId, ok, type AppError, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import type { AuditService } from "./audit.js";
import { AuditOutcome } from "./audit.js";
import type { SupabaseClient } from "./db/client.js";
import type { LicenseEntitlementRow, LicenseLimitRow, LicenseRow, LicenseRowWithKey } from "./db/types.js";
import { isAdmin, type AuthorizationContext } from "./roles.js";

export const LicenseStatus = {
  TRIAL: "trial",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const;
export type LicenseStatus = (typeof LicenseStatus)[keyof typeof LicenseStatus];

export const Role = {
  OWNER: "owner",
  ADMIN: "admin",
  USER: "user",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Future feature entitlements (Section 01 — Licensing Foundation). */
export const Entitlement = {
  FOOTBALL_ANALYSIS: "football_analysis",
  FOOTBALL_TICKETS: "football_tickets",
  FOOTBALL_AUTOMATION: "football_automation",
  AVIATOR_ANALYSIS: "aviator_analysis",
  AVIATOR_AUTOMATION: "aviator_automation",
  TELEGRAM_AUTO_PUBLISH: "telegram_auto_publish",
  TELEGRAM_MULTI_CHANNEL: "telegram_multi_channel",
  WEEKLY_REPORTS: "weekly_reports",
  ADVANCED_ANALYTICS: "advanced_analytics",
} as const;
export type Entitlement = (typeof Entitlement)[keyof typeof Entitlement];

/** Statuses that are permitted to exercise entitlements at all. */
const LICENSE_STATUSES_IN_GOOD_STANDING: readonly LicenseStatus[] = [LicenseStatus.TRIAL, LicenseStatus.ACTIVE];

export interface License {
  readonly id?: UUID;
  readonly userId: UUID;
  readonly status: LicenseStatus;
  readonly role: Role;
  readonly entitlements: readonly Entitlement[];
  readonly issuedAt: ISODateString;
  /**
   * Optional, additive (Section 03). Absent = no start restriction, which
   * is exactly Section 01's original behavior — every existing caller
   * that never set this keeps working unchanged. When present (every
   * database-backed License Section 03 constructs always sets it), a
   * license that has not yet started is correctly treated as unusable.
   */
  readonly startsAt?: ISODateString;
  readonly expiresAt: ISODateString | null;
}

export interface LicenseLimits {
  readonly maxDestinations: number | null;
  readonly maxTicketsPerDay: number | null;
  readonly maxAnalysisRequestsPerDay: number | null;
  readonly maxAviatorSignalsPerDay: number | null;
}

/**
 * Pure decision rule: is this license currently in a usable state at
 * all, independent of any specific entitlement (Section 03 — License
 * Validity)? Usable only when status is TRIAL/ACTIVE, startsAt (if set)
 * has passed, and expiresAt (if set) has not.
 */
export function isLicenseUsable(license: License, now: Date = new Date()): boolean {
  if (!LICENSE_STATUSES_IN_GOOD_STANDING.includes(license.status)) return false;
  if (license.startsAt !== undefined && new Date(license.startsAt).getTime() > now.getTime()) return false;
  if (license.expiresAt !== null && new Date(license.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/**
 * Pure decision rule: does this license currently grant the given
 * entitlement? This is the foundation-level enforcement contract Section
 * 01 asks for, extended in Section 03 to also honor startsAt (see
 * isLicenseUsable). Entitlements are data-driven — never inferred from
 * `plan` here or anywhere else in this codebase.
 */
export function licenseAllows(license: License, entitlement: Entitlement, now: Date = new Date()): boolean {
  return isLicenseUsable(license, now) && license.entitlements.includes(entitlement);
}

/** NULL means "no configured limit" — never interpreted as zero. True when usage is still within the limit, or the limit is unset. */
export function checkLicenseLimit(limitValue: number | null, currentUsage: number): boolean {
  if (limitValue === null) return true;
  return currentUsage < limitValue;
}

/**
 * LicenseService — resolves a user's current license and its
 * entitlements/limits. `getLicense`/`hasEntitlement` are Section 01's
 * original contract, unchanged; `getLicenseForUser`/`getEntitlements`/
 * `getLimits`/`isLicenseActive`/`checkLimit` are the Section 03 spec's
 * named capabilities, added alongside them rather than replacing them.
 */
export interface LicenseService {
  getLicense(userId: string): Promise<License | undefined>;
  hasEntitlement(userId: string, entitlement: Entitlement): Promise<boolean>;
  getLicenseForUser(userId: UUID): Promise<License | undefined>;
  getEntitlements(licenseId: UUID): Promise<readonly Entitlement[]>;
  getLimits(licenseId: UUID): Promise<LicenseLimits | undefined>;
  isLicenseActive(license: License, now?: Date): boolean;
  checkLimit(limitValue: number | null, currentUsage: number): boolean;
}

export class NotImplementedLicenseService implements LicenseService {
  async getLicense(_userId: string): Promise<License | undefined> {
    throw new NotImplementedError("LicenseService.getLicense");
  }
  async hasEntitlement(_userId: string, _entitlement: Entitlement): Promise<boolean> {
    throw new NotImplementedError("LicenseService.hasEntitlement");
  }
  async getLicenseForUser(_userId: UUID): Promise<License | undefined> {
    throw new NotImplementedError("LicenseService.getLicenseForUser");
  }
  async getEntitlements(_licenseId: UUID): Promise<readonly Entitlement[]> {
    throw new NotImplementedError("LicenseService.getEntitlements");
  }
  async getLimits(_licenseId: UUID): Promise<LicenseLimits | undefined> {
    throw new NotImplementedError("LicenseService.getLimits");
  }
  isLicenseActive(_license: License, _now?: Date): boolean {
    throw new NotImplementedError("LicenseService.isLicenseActive");
  }
  checkLimit(_limitValue: number | null, _currentUsage: number): boolean {
    throw new NotImplementedError("LicenseService.checkLimit");
  }
}

// ============================================================
// Repositories (Section 03 — Database Functions / persistence)
// ============================================================

export interface NewLicenseInput {
  readonly userId: UUID;
  readonly licenseKey: string;
  readonly plan: string;
  readonly status: LicenseStatus;
  readonly startsAt: ISODateString;
  readonly expiresAt: ISODateString | null;
  readonly maxDevices: number | null;
  readonly createdBy: UUID | null;
}

export interface LicenseUpdateInput {
  readonly plan?: string;
  readonly status?: LicenseStatus;
  readonly expiresAt?: ISODateString | null;
  readonly maxDevices?: number | null;
  readonly revokedAt?: ISODateString | null;
}

export interface LicensesRepository {
  getActiveOrTrialForUser(userId: UUID): Promise<License | undefined>;
  getById(licenseId: UUID): Promise<License | undefined>;
  listForUser(userId: UUID): Promise<readonly License[]>;
  insert(input: NewLicenseInput): Promise<License>;
  update(licenseId: UUID, patch: LicenseUpdateInput): Promise<License>;
}

export interface LicenseEntitlementsRepository {
  /** Only the currently-enabled feature keys — matches License.entitlements' existing "what this license grants" semantics. */
  listEnabledForLicense(licenseId: UUID): Promise<readonly Entitlement[]>;
  upsert(licenseId: UUID, featureKey: Entitlement, enabled: boolean): Promise<void>;
}

export interface LicenseLimitsRepository {
  getForLicense(licenseId: UUID): Promise<LicenseLimits | undefined>;
  upsert(licenseId: UUID, patch: Partial<LicenseLimits>): Promise<LicenseLimits>;
}

function licenseRowToDomain(row: LicenseRow, role: Role, entitlements: readonly Entitlement[]): License {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    role,
    entitlements,
    issuedAt: row.created_at,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  };
}

/** Generates a random, unguessable license key. Never derived from user-visible data (Telegram id, username, timestamps). */
export function generateLicenseKey(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  return `LIC-${token}`;
}

/**
 * In-memory implementations for fast unit tests of the service/
 * authorization layer, mirroring this codebase's existing
 * InMemoryAgentRegistry/InMemoryAuditService pattern — real logic, no
 * network, no PostgREST dependency.
 */
export class InMemoryLicensesRepository implements LicensesRepository {
  private readonly licenses = new Map<UUID, License & { readonly licenseKey: string }>();

  /**
   * Optional — mirrors `SupabaseLicensesRepository.withEntitlements()`'s
   * real composition (OPEN_QUESTIONS.md #31, resolved for test fixtures
   * that genuinely need it — e.g. Section 12's cross-package E2E chain
   * tests). Additive and opt-in: omitting it keeps every existing
   * caller's behavior byte-identical (entitlements stay `[]`, exactly
   * as before this constructor parameter existed) — this never alters
   * production authorization semantics, only what a test fixture can
   * observe when it explicitly asks for the composition.
   */
  constructor(private readonly entitlementsRepository?: InMemoryLicenseEntitlementsRepository) {}

  private async withEntitlements(license: License & { readonly licenseKey: string }): Promise<License> {
    if (!this.entitlementsRepository) return license;
    const entitlements = await this.entitlementsRepository.listEnabledForLicense(license.id as UUID);
    return { ...license, entitlements };
  }

  async getActiveOrTrialForUser(userId: UUID): Promise<License | undefined> {
    for (const license of this.licenses.values()) {
      if (license.userId === userId && (license.status === LicenseStatus.ACTIVE || license.status === LicenseStatus.TRIAL)) {
        return this.withEntitlements(license);
      }
    }
    return undefined;
  }

  async getById(licenseId: UUID): Promise<License | undefined> {
    const license = this.licenses.get(licenseId);
    return license ? this.withEntitlements(license) : undefined;
  }

  async listForUser(userId: UUID): Promise<readonly License[]> {
    const matches = [...this.licenses.values()].filter((license) => license.userId === userId);
    return Promise.all(matches.map((license) => this.withEntitlements(license)));
  }

  async insert(input: NewLicenseInput): Promise<License> {
    const existing = await this.getActiveOrTrialForUser(input.userId);
    if (existing) {
      throw new ValidationError({ message: "User already has an active or trial license.", code: "LICENSE_ALREADY_ACTIVE" });
    }
    const license: License & { readonly licenseKey: string } = {
      id: generateId(),
      userId: input.userId,
      status: input.status,
      role: Role.USER,
      entitlements: [],
      issuedAt: new Date().toISOString(),
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      licenseKey: input.licenseKey,
    };
    this.licenses.set(license.id as UUID, license);
    return license;
  }

  async update(licenseId: UUID, patch: LicenseUpdateInput): Promise<License> {
    const existing = this.licenses.get(licenseId);
    if (!existing) {
      throw new ValidationError({ message: "License not found.", code: "LICENSE_NOT_FOUND" });
    }
    const updated: License & { readonly licenseKey: string } = {
      ...existing,
      status: patch.status ?? existing.status,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : existing.expiresAt,
    };
    this.licenses.set(licenseId, updated);
    return this.withEntitlements(updated);
  }
}

export class InMemoryLicenseEntitlementsRepository implements LicenseEntitlementsRepository {
  private readonly entitlements = new Map<string, boolean>();

  private key(licenseId: UUID, featureKey: Entitlement): string {
    return `${licenseId}:${featureKey}`;
  }

  async listEnabledForLicense(licenseId: UUID): Promise<readonly Entitlement[]> {
    const result: Entitlement[] = [];
    for (const [key, enabled] of this.entitlements.entries()) {
      if (enabled && key.startsWith(`${licenseId}:`)) {
        result.push(key.slice(licenseId.length + 1) as Entitlement);
      }
    }
    return result;
  }

  async upsert(licenseId: UUID, featureKey: Entitlement, enabled: boolean): Promise<void> {
    this.entitlements.set(this.key(licenseId, featureKey), enabled);
  }
}

export class InMemoryLicenseLimitsRepository implements LicenseLimitsRepository {
  private readonly limits = new Map<UUID, LicenseLimits>();

  async getForLicense(licenseId: UUID): Promise<LicenseLimits | undefined> {
    return this.limits.get(licenseId);
  }

  async upsert(licenseId: UUID, patch: Partial<LicenseLimits>): Promise<LicenseLimits> {
    const existing: LicenseLimits = this.limits.get(licenseId) ?? {
      maxDestinations: null,
      maxTicketsPerDay: null,
      maxAnalysisRequestsPerDay: null,
      maxAviatorSignalsPerDay: null,
    };
    const updated: LicenseLimits = { ...existing, ...patch };
    this.limits.set(licenseId, updated);
    return updated;
  }
}

const LICENSE_SAFE_COLUMNS = "id, user_id, plan, status, starts_at, expires_at, max_devices, created_at, updated_at, revoked_at";

/**
 * Real, Supabase-backed repository (Section 03). Always constructed with
 * a service-role client — see db/client.ts's doc comment: this bypasses
 * RLS entirely, so every caller of a method here must have already
 * authorized the operation itself (see authorization.ts). Never queries
 * license_key except in the one method that explicitly asks for it.
 */
export class SupabaseLicensesRepository implements LicensesRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async resolveUserRole(userId: UUID): Promise<Role> {
    const { data, error } = await this.client.from("users").select("role").eq("id", userId).maybeSingle();
    if (error || !data) return Role.USER;
    return (data as { role: Role }).role;
  }

  private async withEntitlements(row: LicenseRow): Promise<License> {
    const { data } = await this.client.from("license_entitlements").select("feature_key").eq("license_id", row.id).eq("enabled", true);
    const entitlements = ((data ?? []) as readonly Pick<LicenseEntitlementRow, "feature_key">[]).map((r) => r.feature_key as Entitlement);
    const role = await this.resolveUserRole(row.user_id);
    return licenseRowToDomain(row, role, entitlements);
  }

  async getActiveOrTrialForUser(userId: UUID): Promise<License | undefined> {
    const { data, error } = await this.client
      .from("licenses")
      .select(LICENSE_SAFE_COLUMNS)
      .eq("user_id", userId)
      .in("status", [LicenseStatus.ACTIVE, LicenseStatus.TRIAL])
      .maybeSingle();
    if (error || !data) return undefined;
    return this.withEntitlements(data as LicenseRow);
  }

  async getById(licenseId: UUID): Promise<License | undefined> {
    const { data, error } = await this.client.from("licenses").select(LICENSE_SAFE_COLUMNS).eq("id", licenseId).maybeSingle();
    if (error || !data) return undefined;
    return this.withEntitlements(data as LicenseRow);
  }

  async listForUser(userId: UUID): Promise<readonly License[]> {
    const { data, error } = await this.client.from("licenses").select(LICENSE_SAFE_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false });
    if (error || !data) return [];
    return Promise.all((data as readonly LicenseRow[]).map((row) => this.withEntitlements(row)));
  }

  async insert(input: NewLicenseInput): Promise<License> {
    const { data, error } = await this.client
      .from("licenses")
      .insert({
        user_id: input.userId,
        license_key: input.licenseKey,
        plan: input.plan,
        status: input.status,
        starts_at: input.startsAt,
        expires_at: input.expiresAt,
        max_devices: input.maxDevices,
        created_by: input.createdBy,
      })
      .select(LICENSE_SAFE_COLUMNS)
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to create license.", code: "LICENSE_CREATE_FAILED", context: { reason: error?.message } });
    }
    return this.withEntitlements(data as LicenseRow);
  }

  async update(licenseId: UUID, patch: LicenseUpdateInput): Promise<License> {
    const updatePayload: Record<string, unknown> = {};
    if (patch.plan !== undefined) updatePayload.plan = patch.plan;
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.expiresAt !== undefined) updatePayload.expires_at = patch.expiresAt;
    if (patch.maxDevices !== undefined) updatePayload.max_devices = patch.maxDevices;
    if (patch.revokedAt !== undefined) updatePayload.revoked_at = patch.revokedAt;

    const { data, error } = await this.client.from("licenses").update(updatePayload).eq("id", licenseId).select(LICENSE_SAFE_COLUMNS).single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to update license.", code: "LICENSE_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return this.withEntitlements(data as LicenseRow);
  }

  /** The one place a raw license_key is ever read — never exposed beyond a dedicated, explicitly-invoked, service-role-backed operation. */
  async getRawLicenseKey(licenseId: UUID): Promise<string | undefined> {
    const { data, error } = await this.client.from("licenses").select("license_key").eq("id", licenseId).maybeSingle();
    if (error || !data) return undefined;
    return (data as Pick<LicenseRowWithKey, "license_key">).license_key;
  }
}

export class SupabaseLicenseEntitlementsRepository implements LicenseEntitlementsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listEnabledForLicense(licenseId: UUID): Promise<readonly Entitlement[]> {
    const { data, error } = await this.client.from("license_entitlements").select("feature_key").eq("license_id", licenseId).eq("enabled", true);
    if (error || !data) return [];
    return (data as readonly Pick<LicenseEntitlementRow, "feature_key">[]).map((row) => row.feature_key as Entitlement);
  }

  async upsert(licenseId: UUID, featureKey: Entitlement, enabled: boolean): Promise<void> {
    const { error } = await this.client.from("license_entitlements").upsert({ license_id: licenseId, feature_key: featureKey, enabled }, { onConflict: "license_id,feature_key" });
    if (error) {
      throw new ValidationError({ message: "Failed to update entitlement.", code: "ENTITLEMENT_UPDATE_FAILED", context: { reason: error.message } });
    }
  }
}

export class SupabaseLicenseLimitsRepository implements LicenseLimitsRepository {
  constructor(private readonly client: SupabaseClient) {}

  private toDomain(row: LicenseLimitRow): LicenseLimits {
    return {
      maxDestinations: row.max_destinations,
      maxTicketsPerDay: row.max_tickets_per_day,
      maxAnalysisRequestsPerDay: row.max_analysis_requests_per_day,
      maxAviatorSignalsPerDay: row.max_aviator_signals_per_day,
    };
  }

  async getForLicense(licenseId: UUID): Promise<LicenseLimits | undefined> {
    const { data, error } = await this.client.from("license_limits").select("*").eq("license_id", licenseId).maybeSingle();
    if (error || !data) return undefined;
    return this.toDomain(data as LicenseLimitRow);
  }

  async upsert(licenseId: UUID, patch: Partial<LicenseLimits>): Promise<LicenseLimits> {
    const payload: Record<string, unknown> = { license_id: licenseId };
    if (patch.maxDestinations !== undefined) payload.max_destinations = patch.maxDestinations;
    if (patch.maxTicketsPerDay !== undefined) payload.max_tickets_per_day = patch.maxTicketsPerDay;
    if (patch.maxAnalysisRequestsPerDay !== undefined) payload.max_analysis_requests_per_day = patch.maxAnalysisRequestsPerDay;
    if (patch.maxAviatorSignalsPerDay !== undefined) payload.max_aviator_signals_per_day = patch.maxAviatorSignalsPerDay;

    const { data, error } = await this.client.from("license_limits").upsert(payload, { onConflict: "license_id" }).select("*").single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to update license limits.", code: "LIMIT_UPDATE_FAILED", context: { reason: error?.message } });
    }
    return this.toDomain(data as LicenseLimitRow);
  }
}

/** Real, database-backed LicenseService (Section 03). Takes repositories, not a raw client, so it works identically against the in-memory or Supabase-backed implementations. */
export class DatabaseLicenseService implements LicenseService {
  constructor(
    private readonly licenses: LicensesRepository,
    private readonly entitlements: LicenseEntitlementsRepository,
    private readonly limits: LicenseLimitsRepository,
  ) {}

  async getLicense(userId: string): Promise<License | undefined> {
    return this.licenses.getActiveOrTrialForUser(userId);
  }

  async hasEntitlement(userId: string, entitlement: Entitlement): Promise<boolean> {
    const license = await this.getLicense(userId);
    if (!license) return false;
    return licenseAllows(license, entitlement);
  }

  async getLicenseForUser(userId: UUID): Promise<License | undefined> {
    return this.licenses.getActiveOrTrialForUser(userId);
  }

  async getEntitlements(licenseId: UUID): Promise<readonly Entitlement[]> {
    return this.entitlements.listEnabledForLicense(licenseId);
  }

  async getLimits(licenseId: UUID): Promise<LicenseLimits | undefined> {
    return this.limits.getForLicense(licenseId);
  }

  isLicenseActive(license: License, now: Date = new Date()): boolean {
    return isLicenseUsable(license, now);
  }

  checkLimit(limitValue: number | null, currentUsage: number): boolean {
    return checkLicenseLimit(limitValue, currentUsage);
  }
}

// ============================================================
// Admin operations (Section 03 — Admin Operations)
//
// Every function here: verifies caller authorization, validates input,
// performs the operation via the service-role client, and records an
// audit event — in that order. A plain USER can never reach a successful
// outcome from any of these (see authorization.ts / the RLS tests in
// tests/database/ for the same invariant enforced independently at the
// database level).
// ============================================================

async function recordAudit(
  audit: AuditService,
  actor: AuthorizationContext,
  action: string,
  resourceId: string,
  outcome: (typeof AuditOutcome)[keyof typeof AuditOutcome],
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await audit.record({ actor: actor.userId, action, resource: "license", resourceId, outcome, requestId: generateId(), metadata });
}

export async function createLicense(
  licensesRepo: LicensesRepository,
  audit: AuditService,
  actingUser: AuthorizationContext,
  input: { readonly userId: UUID; readonly plan: string; readonly status: LicenseStatus; readonly startsAt: ISODateString; readonly expiresAt: ISODateString | null; readonly maxDevices: number | null },
): Promise<Result<License, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    const license = await licensesRepo.insert({ ...input, licenseKey: generateLicenseKey(), createdBy: actingUser.userId });
    await recordAudit(audit, actingUser, "license_created", license.id ?? input.userId, AuditOutcome.SUCCESS, { plan: input.plan, status: input.status });
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function updateLicense(
  licensesRepo: LicensesRepository,
  audit: AuditService,
  actingUser: AuthorizationContext,
  licenseId: UUID,
  patch: LicenseUpdateInput,
): Promise<Result<License, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    const license = await licensesRepo.update(licenseId, patch);
    await recordAudit(audit, actingUser, "license_updated", licenseId, AuditOutcome.SUCCESS, { patch });
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function suspendLicense(licensesRepo: LicensesRepository, audit: AuditService, actingUser: AuthorizationContext, licenseId: UUID): Promise<Result<License, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    const license = await licensesRepo.update(licenseId, { status: LicenseStatus.SUSPENDED });
    await recordAudit(audit, actingUser, "license_suspended", licenseId, AuditOutcome.SUCCESS);
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function revokeLicense(licensesRepo: LicensesRepository, audit: AuditService, actingUser: AuthorizationContext, licenseId: UUID): Promise<Result<License, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    const license = await licensesRepo.update(licenseId, { status: LicenseStatus.REVOKED, revokedAt: new Date().toISOString() });
    await recordAudit(audit, actingUser, "license_revoked", licenseId, AuditOutcome.SUCCESS);
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function assignEntitlement(
  entitlementsRepo: LicenseEntitlementsRepository,
  audit: AuditService,
  actingUser: AuthorizationContext,
  licenseId: UUID,
  featureKey: Entitlement,
): Promise<Result<true, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    await entitlementsRepo.upsert(licenseId, featureKey, true);
    await recordAudit(audit, actingUser, "entitlement_changed", licenseId, AuditOutcome.SUCCESS, { featureKey, enabled: true });
    return ok(true);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function removeEntitlement(
  entitlementsRepo: LicenseEntitlementsRepository,
  audit: AuditService,
  actingUser: AuthorizationContext,
  licenseId: UUID,
  featureKey: Entitlement,
): Promise<Result<true, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    await entitlementsRepo.upsert(licenseId, featureKey, false);
    await recordAudit(audit, actingUser, "entitlement_changed", licenseId, AuditOutcome.SUCCESS, { featureKey, enabled: false });
    return ok(true);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function setLicenseLimit(
  limitsRepo: LicenseLimitsRepository,
  audit: AuditService,
  actingUser: AuthorizationContext,
  licenseId: UUID,
  patch: Partial<LicenseLimits>,
): Promise<Result<LicenseLimits, AppError>> {
  if (!isAdmin(actingUser)) {
    return err(new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" }));
  }
  try {
    const limits = await limitsRepo.upsert(licenseId, patch);
    await recordAudit(audit, actingUser, "limit_changed", licenseId, AuditOutcome.SUCCESS, { patch });
    return ok(limits);
  } catch (error) {
    return err(error as AppError);
  }
}
