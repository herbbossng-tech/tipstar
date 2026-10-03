import { ValidationError, err, generateId, ok, type AppError, type ISODateString, type Result, type UUID } from "@sport-os/shared";
import type { AuditService } from "../audit.js";
import { AuditOutcome } from "../audit.js";
import type { UsersRepository } from "../identity.js";
import { LicenseStatus, type License, type LicenseLimits, type LicenseLimitsRepository, type LicensesRepository } from "../license.js";
import { requireAdmin } from "../authorization.js";
import type { AppUser } from "../roles.js";
import type { AuthorizationContext } from "../roles.js";

/**
 * Section 11 — License administration operations. This file does NOT
 * reintroduce license authorization — `createLicense`/`updateLicense`/
 * `suspendLicense`/`revokeLicense`/`assignEntitlement`/`removeEntitlement`/
 * `setLicenseLimit` already exist in `../license.ts` (Section 03) and
 * remain the only place those specific mutations happen. This module
 * only adds the two genuinely missing state transitions (`renewLicense`,
 * `reactivateLicense`) and the read-side admin composition views
 * (`listUsersForAdmin`/`inspectUserForAdmin`) the Mini App admin UI and
 * bot admin commands need — every one of them calls `requireAdmin()`
 * first and goes through the existing repositories, never a second
 * licensing model.
 */

async function recordLicenseAudit(audit: AuditService, actor: AuthorizationContext, action: string, resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await audit.record({ actor: actor.userId, action, resource: "license", resourceId, outcome: AuditOutcome.SUCCESS, requestId: generateId(), metadata });
}

/**
 * Renews a license by extending `expiresAt` into the future. "Renew" is
 * explicitly NOT available for a REVOKED license (revocation is
 * terminal in this codebase's locked state machine — §B's own list only
 * names "restore/reactivate where the existing state machine permits
 * it," and revocation is deliberately irreversible). An EXPIRED license
 * is renewed back to ACTIVE; an already-ACTIVE/TRIAL license simply gets
 * its expiry pushed out; a SUSPENDED license must go through
 * `reactivateLicense` first (renewing a suspension would silently
 * un-suspend it, which is `reactivateLicense`'s job, not this one's).
 */
export async function renewLicense(licensesRepo: LicensesRepository, audit: AuditService, actingUser: AuthorizationContext, licenseId: UUID, newExpiresAt: ISODateString): Promise<Result<License, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const existing = await licensesRepo.getById(licenseId);
  if (!existing) {
    return err(new ValidationError({ message: "License not found.", code: "LICENSE_NOT_FOUND" }));
  }
  if (existing.status === LicenseStatus.REVOKED) {
    return err(new ValidationError({ message: "A revoked license cannot be renewed.", code: "LICENSE_REVOKED_IMMUTABLE" }));
  }
  if (existing.status === LicenseStatus.SUSPENDED) {
    return err(new ValidationError({ message: "A suspended license must be reactivated before it can be renewed.", code: "LICENSE_SUSPENDED_REQUIRES_REACTIVATION" }));
  }
  if (new Date(newExpiresAt).getTime() <= Date.now()) {
    return err(new ValidationError({ message: "The new expiry must be in the future.", code: "LICENSE_RENEWAL_EXPIRY_NOT_FUTURE" }));
  }

  try {
    const nextStatus = existing.status === LicenseStatus.EXPIRED ? LicenseStatus.ACTIVE : existing.status;
    const license = await licensesRepo.update(licenseId, { status: nextStatus, expiresAt: newExpiresAt });
    await recordLicenseAudit(audit, actingUser, "license_renewed", licenseId, { previousStatus: existing.status, newExpiresAt });
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

/** Reverses a suspension — the ONLY reverse transition this state machine permits (never EXPIRED->ACTIVE here; that is `renewLicense`'s job, and never REVOKED->anything). */
export async function reactivateLicense(licensesRepo: LicensesRepository, audit: AuditService, actingUser: AuthorizationContext, licenseId: UUID): Promise<Result<License, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const existing = await licensesRepo.getById(licenseId);
  if (!existing) {
    return err(new ValidationError({ message: "License not found.", code: "LICENSE_NOT_FOUND" }));
  }
  if (existing.status !== LicenseStatus.SUSPENDED) {
    return err(new ValidationError({ message: `Only a suspended license may be reactivated (current status: "${existing.status}").`, code: "LICENSE_NOT_SUSPENDED" }));
  }

  try {
    const license = await licensesRepo.update(licenseId, { status: LicenseStatus.ACTIVE });
    await recordLicenseAudit(audit, actingUser, "license_reactivated", licenseId);
    return ok(license);
  } catch (error) {
    return err(error as AppError);
  }
}

/** One row of the admin "list users" view — the current license at a glance, never the raw `license_key`. `plan` is deliberately absent: the domain `License` type (`../license.ts`) does not surface it today — adding a new field to that locked domain type is out of scope here. */
export interface AdminUserSummary {
  readonly user: AppUser;
  readonly currentLicenseStatus: LicenseStatus | undefined;
  readonly currentLicenseExpiresAt: ISODateString | null | undefined;
}

export interface ListUsersForAdminDependencies {
  readonly users: UsersRepository;
  readonly licenses: LicensesRepository;
}

const MAX_ADMIN_LIST_PAGE_SIZE = 100;

/** Bounded, admin-only user listing (§Y — "do not allow a client to request unlimited records"). `limit` is always clamped, never trusted verbatim from a caller. */
export async function listUsersForAdmin(deps: ListUsersForAdminDependencies, actingUser: AuthorizationContext, params: { readonly limit: number; readonly offset: number }): Promise<Result<readonly AdminUserSummary[], AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const boundedLimit = Math.max(1, Math.min(params.limit, MAX_ADMIN_LIST_PAGE_SIZE));
  const users = await deps.users.listAll({ limit: boundedLimit, offset: Math.max(0, params.offset) });
  const summaries = await Promise.all(
    users.map(async (user): Promise<AdminUserSummary> => {
      const license = await deps.licenses.getActiveOrTrialForUser(user.id);
      return { user, currentLicenseStatus: license?.status, currentLicenseExpiresAt: license?.expiresAt };
    }),
  );
  return ok(summaries);
}

/** Real, computable usage figures only — never a fabricated number for a metric this codebase cannot actually track yet (see the module doc comment on `destinationsConfigured`). */
export interface AdminUserUsage {
  /** A real count from the Section 10 destination catalog (`TelegramDestination.createdBy`). */
  readonly destinationsConfigured: number;
  /**
   * `undefined` — not `0` — because no repository persists per-user
   * ticket/execution history to Supabase yet (see
   * `OPEN_QUESTIONS.md` #25, still unresolved). Never fabricated.
   */
  readonly ticketsCreatedToday: number | undefined;
}

export interface AdminUserDetail {
  readonly user: AppUser;
  /** Full license HISTORY for this user — every license row, not just the current one. */
  readonly licenseHistory: readonly License[];
  readonly currentLicense: License | undefined;
  readonly currentLimits: LicenseLimits | undefined;
  readonly usage: AdminUserUsage;
}

export interface InspectUserForAdminDependencies {
  readonly users: UsersRepository;
  readonly licenses: LicensesRepository;
  readonly limits: LicenseLimitsRepository;
  /** Duck-typed against `TelegramDestinationManager` (`@sport-os/telegram`) — this package cannot depend on it (the reverse dependency already exists via `@sport-os/platform` -> `@sport-os/telegram`), so only the one method actually used is required here. */
  readonly destinations: { list(): Promise<readonly { readonly createdBy?: string }[]> };
}

export async function inspectUserForAdmin(deps: InspectUserForAdminDependencies, actingUser: AuthorizationContext, userId: UUID): Promise<Result<AdminUserDetail, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const user = await deps.users.findById(userId);
  if (!user) {
    return err(new ValidationError({ message: "User not found.", code: "USER_NOT_FOUND" }));
  }

  const licenseHistory = await deps.licenses.listForUser(userId);
  const currentLicense = await deps.licenses.getActiveOrTrialForUser(userId);
  const currentLimits = currentLicense?.id ? await deps.limits.getForLicense(currentLicense.id) : undefined;
  const allDestinations = await deps.destinations.list();
  const destinationsConfigured = allDestinations.filter((d) => d.createdBy === userId).length;

  return ok({
    user,
    licenseHistory,
    currentLicense,
    currentLimits,
    usage: { destinationsConfigured, ticketsCreatedToday: undefined },
  });
}
