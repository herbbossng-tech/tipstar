import { UserRole } from "@tipstar/types";

/**
 * Fine-grained permissions. Authorization checks (server-side and RLS
 * policies) should be written against these, not against role names
 * directly, so a role's privileges can change in one place.
 */
export const Permission = {
  VIEW_FREE_PICKS: "view_free_picks",
  VIEW_PREMIUM_PICKS: "view_premium_picks",
  VIEW_PERFORMANCE: "view_performance",
  MANAGE_OWN_PROFILE: "manage_own_profile",
  MODERATE_CONTENT: "moderate_content",
  VIEW_INTELLIGENCE_INTERNALS: "view_intelligence_internals",
  PUBLISH_PICKS: "publish_picks",
  CORRECT_PICKS: "correct_picks",
  MANAGE_USERS: "manage_users",
  MANAGE_SUBSCRIPTIONS: "manage_subscriptions",
  MANAGE_AFFILIATES: "manage_affiliates",
  MANAGE_SYSTEM_SETTINGS: "manage_system_settings",
  VIEW_AUDIT_LOGS: "view_audit_logs",
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Least-privilege role -> permission mapping (Engineering Constitution
 * section 22). This is the shared vocabulary for server-side checks; it is
 * NOT itself an enforcement mechanism — routes/edge functions and RLS
 * policies must consult it, not trust a client-asserted role.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  [UserRole.USER]: [Permission.VIEW_FREE_PICKS, Permission.MANAGE_OWN_PROFILE],
  [UserRole.PREMIUM_USER]: [Permission.VIEW_FREE_PICKS, Permission.VIEW_PREMIUM_PICKS, Permission.VIEW_PERFORMANCE, Permission.MANAGE_OWN_PROFILE],
  [UserRole.PARTNER_USER]: [Permission.VIEW_FREE_PICKS, Permission.VIEW_PREMIUM_PICKS, Permission.VIEW_PERFORMANCE, Permission.MANAGE_OWN_PROFILE],
  [UserRole.MODERATOR]: [Permission.VIEW_FREE_PICKS, Permission.VIEW_PREMIUM_PICKS, Permission.MANAGE_OWN_PROFILE, Permission.MODERATE_CONTENT],
  [UserRole.ANALYST]: [
    Permission.VIEW_FREE_PICKS,
    Permission.VIEW_PREMIUM_PICKS,
    Permission.VIEW_PERFORMANCE,
    Permission.MANAGE_OWN_PROFILE,
    Permission.VIEW_INTELLIGENCE_INTERNALS,
  ],
  [UserRole.ADMIN]: [
    Permission.VIEW_FREE_PICKS,
    Permission.VIEW_PREMIUM_PICKS,
    Permission.VIEW_PERFORMANCE,
    Permission.MANAGE_OWN_PROFILE,
    Permission.MODERATE_CONTENT,
    Permission.VIEW_INTELLIGENCE_INTERNALS,
    Permission.PUBLISH_PICKS,
    Permission.CORRECT_PICKS,
    Permission.MANAGE_USERS,
    Permission.MANAGE_SUBSCRIPTIONS,
    Permission.MANAGE_AFFILIATES,
    Permission.VIEW_AUDIT_LOGS,
  ],
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
};

export function hasPermission(roles: readonly UserRole[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}
