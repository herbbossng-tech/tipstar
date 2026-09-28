import { AuthorizationError, type UUID } from "@sport-os/shared";
import { isActiveUser, isAdmin, isOwner, type AuthorizationContext } from "./roles.js";

/**
 * Central authorization guards (Section 03 — Authorization Model).
 * "AUTHENTICATION: who is this? AUTHORIZATION: what may this
 * authenticated user do?" — every admin operation in this package calls
 * one of these before doing anything else. Each returns an
 * AuthorizationError describing why access was denied, or `undefined`
 * when the caller is authorized — callers do `const denied = requireX(...); if (denied) return err(denied);`.
 *
 * These duplicate, deliberately, the same rules the database enforces
 * independently via RLS and the enforce_user_self_service_boundaries
 * trigger (see supabase/migrations/ and tests/database/) — "Neither
 * layer should be treated as optional."
 */

export function requireAdmin(context: AuthorizationContext): AuthorizationError | undefined {
  if (isAdmin(context)) return undefined;
  return new AuthorizationError({ message: "This action requires administrative authority.", code: "AUTHORIZATION_ADMIN_REQUIRED" });
}

export function requireOwner(context: AuthorizationContext): AuthorizationError | undefined {
  if (isOwner(context)) return undefined;
  return new AuthorizationError({ message: "This action requires owner authority.", code: "AUTHORIZATION_OWNER_REQUIRED" });
}

export function requireSelfOrAdmin(context: AuthorizationContext, targetUserId: UUID): AuthorizationError | undefined {
  if (context.userId === targetUserId || isAdmin(context)) return undefined;
  return new AuthorizationError({ message: "You may only access your own resource.", code: "AUTHORIZATION_NOT_SELF" });
}

/** Nobody may perform a self-service change through this path — see users_self_service_guard's trigger for the same rule enforced at the database level. */
export function requireNotSelf(context: AuthorizationContext, targetUserId: UUID, message: string): AuthorizationError | undefined {
  if (context.userId !== targetUserId) return undefined;
  return new AuthorizationError({ message, code: "AUTHORIZATION_SELF_SERVICE_DENIED" });
}

export function requireActiveUser(context: AuthorizationContext): AuthorizationError | undefined {
  if (isActiveUser(context)) return undefined;
  return new AuthorizationError({ message: "Your account is not active.", code: "AUTHORIZATION_ACCOUNT_NOT_ACTIVE" });
}
