import { isActiveUser, isAdmin, isOwner, type AuthorizationContext } from "../roles.js";

/**
 * Section 11 Part C — the explicit OWNER/ADMIN/USER authorization
 * matrix, STATED, not invented. Every capability named here is already
 * enforced by a real `requireAdmin()`/`requireOwner()` call somewhere in
 * this codebase (license.ts, user-admin.ts, destination-manager.ts,
 * this package's own license-admin.ts) — this module adds NO new
 * authorization rule; it is a typed, queryable VIEW of the rules that
 * already exist, for the Mini App admin UI and bot admin commands to
 * render "what can I do" without hand-rolling role checks in each
 * screen. The one and only source of truth for whether an action is
 * actually allowed remains the real `requireAdmin()`/`requireOwner()`
 * call at the point of use — `canPerform()` below must never be used AS
 * that check; it is read-only, presentation-facing information.
 */

export const OperationalCapability = {
  LICENSE_ADMINISTRATION: "license_administration",
  ENTITLEMENT_ADMINISTRATION: "entitlement_administration",
  PLATFORM_SETTINGS: "platform_settings",
  AGENT_OPERATIONS: "agent_operations",
  JOB_OPERATIONS: "job_operations",
  REPORTING_OPERATIONS: "reporting_operations",
  DESTINATION_OPERATIONS: "destination_operations",
  AUDIT_INSPECTION: "audit_inspection",
  SYSTEM_HEALTH: "system_health",
  OPERATIONAL_RETRY: "operational_retry",
} as const;
export type OperationalCapability = (typeof OperationalCapability)[keyof typeof OperationalCapability];

/**
 * OWNER has every capability ADMIN has, plus none that are exclusively
 * OWNER-only in this codebase today — Section 03's `requireOwner()` is
 * reserved for creating/removing an OWNER role and the one-time owner
 * bootstrap claim (`owner-bootstrap.ts`), neither of which is an
 * "operational" capability in Section 11's sense. If a future
 * capability genuinely needs OWNER-only gating, add it to
 * `OWNER_ONLY_CAPABILITIES` below rather than widening ADMIN.
 */
const OWNER_ONLY_CAPABILITIES: ReadonlySet<OperationalCapability> = new Set();

/** Every capability an ADMIN (and therefore also an OWNER) may exercise, per the real `requireAdmin()` calls already in this codebase. */
const ADMIN_CAPABILITIES: ReadonlySet<OperationalCapability> = new Set(Object.values(OperationalCapability));

/**
 * The effective authorization matrix (§C), as a plain, documentation-
 * friendly table. Rendered once, imported by docs generation / the admin
 * UI's own "what am I allowed to do" help text — never re-derived ad
 * hoc elsewhere.
 */
export const AUTHORIZATION_MATRIX: Readonly<Record<"OWNER" | "ADMIN" | "USER", readonly OperationalCapability[]>> = {
  OWNER: Object.values(OperationalCapability),
  ADMIN: [...ADMIN_CAPABILITIES].filter((capability) => !OWNER_ONLY_CAPABILITIES.has(capability)),
  USER: [],
};

/**
 * Read-only capability check for UI rendering ONLY (§R: "frontend gating
 * is cosmetic... every backend endpoint independently verifies"). Also
 * requires an ACTIVE account — a suspended/disabled OWNER/ADMIN has no
 * operational capability here, mirroring `requireActiveUser()`'s own
 * rule.
 */
export function canPerform(actingUser: AuthorizationContext, capability: OperationalCapability): boolean {
  if (!isActiveUser(actingUser)) return false;
  if (OWNER_ONLY_CAPABILITIES.has(capability)) return isOwner(actingUser);
  return isAdmin(actingUser);
}
