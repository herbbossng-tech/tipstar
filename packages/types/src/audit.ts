import type { ISODateString, Maybe, UUID } from "./common.js";

/**
 * Auditable system action categories (Engineering Constitution section S).
 * Keep this list additive — never repurpose an existing action name.
 */
export const AuditAction = {
  USER_AUTHENTICATED: "user_authenticated",
  USER_AUTH_FAILED: "user_auth_failed",
  PROVIDER_FAILURE: "provider_failure",
  MODEL_EXECUTED: "model_executed",
  PICK_GENERATED: "pick_generated",
  PICK_PUBLISHED: "pick_published",
  PICK_CORRECTED: "pick_corrected",
  PICK_SETTLED: "pick_settled",
  SUBSCRIPTION_CHANGED: "subscription_changed",
  AFFILIATE_ATTRIBUTED: "affiliate_attributed",
  ADMIN_ACTION: "admin_action",
  ERROR: "error",
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditLogEntry {
  readonly id: UUID;
  readonly action: AuditAction;
  readonly actorUserId: Maybe<UUID>;
  readonly targetType: Maybe<string>;
  readonly targetId: Maybe<string>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly correlationId: Maybe<string>;
  readonly occurredAt: ISODateString;
}
