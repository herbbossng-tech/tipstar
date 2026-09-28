import { ValidationError, err, generateId, ok, type AppError, type Result, type UUID } from "@sport-os/shared";
import type { AuditService } from "./audit.js";
import { AuditOutcome } from "./audit.js";
import type { UsersRepository } from "./identity.js";
import { Role } from "./license.js";
import { requireAdmin, requireNotSelf, requireOwner } from "./authorization.js";
import { UserStatus, type AppUser, type AuthorizationContext } from "./roles.js";

/**
 * User administration operations (Section 03 — Admin Operations / Role
 * Checking). Mirrors, in application code, exactly the invariants the
 * database enforces independently via RLS + the
 * enforce_user_self_service_boundaries trigger — see
 * tests/database/20_rls_cases.sql for the same rules validated at the
 * database level.
 */

async function recordUserAudit(audit: AuditService, actor: AuthorizationContext, action: string, targetUserId: UUID, metadata: Record<string, unknown> = {}): Promise<void> {
  await audit.record({ actor: actor.userId, action, resource: "user", resourceId: targetUserId, outcome: AuditOutcome.SUCCESS, requestId: generateId(), metadata });
}

export async function suspendUser(users: UsersRepository, audit: AuditService, actingUser: AuthorizationContext, targetUserId: UUID): Promise<Result<AppUser, AppError>> {
  const denied = requireAdmin(actingUser) ?? requireNotSelf(actingUser, targetUserId, "You may not suspend your own account.");
  if (denied) return err(denied);
  try {
    const user = await users.updateStatus(targetUserId, UserStatus.SUSPENDED);
    await recordUserAudit(audit, actingUser, "user_suspended", targetUserId);
    return ok(user);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function reactivateUser(users: UsersRepository, audit: AuditService, actingUser: AuthorizationContext, targetUserId: UUID): Promise<Result<AppUser, AppError>> {
  const denied = requireAdmin(actingUser) ?? requireNotSelf(actingUser, targetUserId, "You may not reactivate your own account.");
  if (denied) return err(denied);
  try {
    const user = await users.updateStatus(targetUserId, UserStatus.ACTIVE);
    await recordUserAudit(audit, actingUser, "user_reactivated", targetUserId);
    return ok(user);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function changeUserRole(users: UsersRepository, audit: AuditService, actingUser: AuthorizationContext, targetUserId: UUID, newRole: Role): Promise<Result<AppUser, AppError>> {
  const baseDenied = requireAdmin(actingUser) ?? requireNotSelf(actingUser, targetUserId, "You may not change your own role.");
  if (baseDenied) return err(baseDenied);

  const target = await users.findById(targetUserId);
  if (!target) {
    return err(new ValidationError({ message: "User not found.", code: "USER_NOT_FOUND" }));
  }

  // An ADMIN may never create or remove an OWNER — only an OWNER may.
  if ((newRole === Role.OWNER || target.role === Role.OWNER)) {
    const ownerDenied = requireOwner(actingUser);
    if (ownerDenied) return err(ownerDenied);
  }

  try {
    const user = await users.updateRole(targetUserId, newRole);
    await recordUserAudit(audit, actingUser, "role_changed", targetUserId, { fromRole: target.role, toRole: newRole });
    return ok(user);
  } catch (error) {
    return err(error as AppError);
  }
}
