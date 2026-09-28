/**
 * Row shapes matching supabase/migrations/ exactly (Section 03). These
 * are the wire shape Supabase actually returns (snake_case) — repository
 * implementations translate to/from the camelCase domain types declared
 * in identity.ts/license.ts/roles.ts. Kept separate on purpose so a
 * schema-column rename only touches this file and its one repository,
 * never every caller.
 */

export type UserRoleRow = "owner" | "admin" | "user";
export type UserStatusRow = "active" | "suspended" | "disabled";
export type LicenseStatusRow = "trial" | "active" | "suspended" | "expired" | "revoked";
export type AuditOutcomeRow = "success" | "failure" | "denied";

export interface UserRow {
  readonly id: string;
  readonly telegram_user_id: number;
  readonly username: string | null;
  readonly first_name: string;
  readonly last_name: string | null;
  readonly language_code: string | null;
  readonly is_premium: boolean;
  readonly role: UserRoleRow;
  readonly status: UserStatusRow;
  readonly last_authenticated_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The safe SELECT shape — omits license_key, matching the RLS grant. */
export interface LicenseRow {
  readonly id: string;
  readonly user_id: string;
  readonly plan: string;
  readonly status: LicenseStatusRow;
  readonly starts_at: string;
  readonly expires_at: string | null;
  readonly max_devices: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly revoked_at: string | null;
}

/** Only ever read/written by service-role code that has a genuine reason to see the raw key. */
export interface LicenseRowWithKey extends LicenseRow {
  readonly license_key: string;
  readonly created_by: string | null;
}

export interface LicenseEntitlementRow {
  readonly id: string;
  readonly license_id: string;
  readonly feature_key: string;
  readonly enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LicenseLimitRow {
  readonly id: string;
  readonly license_id: string;
  readonly max_destinations: number | null;
  readonly max_tickets_per_day: number | null;
  readonly max_analysis_requests_per_day: number | null;
  readonly max_aviator_signals_per_day: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AuthSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly token_hash: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly revoked_reason: string | null;
  readonly created_at: string;
}

export interface AuditLogRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly outcome: AuditOutcomeRow;
  readonly request_id: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface PlatformSettingsRow {
  readonly id: true;
  readonly owner_bootstrapped_at: string | null;
  readonly owner_bootstrapped_user_id: string | null;
}
