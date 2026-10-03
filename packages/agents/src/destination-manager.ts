import { AuditOutcome, requireAdmin, type AuditService, type AuthorizationContext } from "@sport-os/platform";
import { err, generateId, ok, ValidationError, type AppError, type Result, type UUID } from "@sport-os/shared";
import {
  TelegramDestinationVerificationStatus,
  type TelegramDestination,
  type TelegramDestinationManager,
  type TelegramService,
} from "@sport-os/telegram";

/**
 * Destination management (Section 10 §9/§10/§28/§29). "Destination
 * management is OWNER/ADMIN-controlled, backend-enforced (frontend is
 * not security)." Mirrors, deliberately, exactly the shape of
 * `packages/platform/src/user-admin.ts`: every function here is a
 * plain, module-level function taking the (already-persisted)
 * repository + an `AuditService` + the caller's already-authenticated
 * `AuthorizationContext` as parameters, checks `requireAdmin()` FIRST,
 * and records an audit event on every state change. These functions —
 * never a direct call into `TelegramDestinationManager` from a bot
 * command handler or edge function — are the one sanctioned way a
 * destination row is created, verified, updated, or disabled.
 *
 * Deliberately does NOT implement a full ops console (list/inspect
 * only as needed for the bot's own admin commands) — "provide only the
 * service/domain capabilities Section 10 needs... do not build the
 * full Section 11 ops console."
 */

export interface NewDestinationInput {
  readonly telegramChatId: string;
  readonly name: string;
  readonly type: TelegramDestination["type"];
  readonly enabled: boolean;
  readonly autoPublish: boolean;
  readonly publishBookingCode: boolean;
  readonly publishTicket: boolean;
  readonly publishResults: boolean;
  readonly publishWeeklyReport: boolean;
}

export interface DestinationManagerDependencies {
  readonly destinations: TelegramDestinationManager;
  readonly telegram: TelegramService;
  readonly audit: AuditService;
}

async function recordDestinationAudit(audit: AuditService, actor: AuthorizationContext, action: string, destinationId: UUID, outcome: AuditOutcome = AuditOutcome.SUCCESS, metadata: Record<string, unknown> = {}): Promise<void> {
  await audit.record({ actor: actor.userId, action, resource: "telegram_destination", resourceId: destinationId, outcome, requestId: generateId(), metadata });
}

/** A new destination is always created UNVERIFIED (§10: "never marked VERIFIED just because a chat id was typed in") — a separate `verifyDestination()` call is required before it can ever be eligible to publish. */
export async function createDestination(deps: DestinationManagerDependencies, actingUser: AuthorizationContext, input: NewDestinationInput): Promise<Result<TelegramDestination, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);
  try {
    const destination = await deps.destinations.create(
      { ...input, verificationStatus: TelegramDestinationVerificationStatus.UNVERIFIED, verifiedAt: undefined },
      actingUser.userId,
    );
    await recordDestinationAudit(deps.audit, actingUser, "destination_created", destination.destinationId, AuditOutcome.SUCCESS, { telegramChatId: destination.telegramChatId, type: destination.type });
    return ok(destination);
  } catch (error) {
    return err(error as AppError);
  }
}

/**
 * Confirms (via the Bot API's own `getChat`) that this bot can actually
 * reach the configured chat — "verify Telegram access when adding a
 * destination... never bypass Telegram permissions." A failed check
 * marks the destination FAILED rather than throwing: "store an explicit
 * unverified/incomplete state rather than pretending success" is itself
 * the successful outcome of calling this function — only an
 * authorization/not-found error on the admin action itself is an `err`.
 */
export async function verifyDestination(deps: DestinationManagerDependencies, actingUser: AuthorizationContext, destinationId: UUID): Promise<Result<TelegramDestination, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const destination = await deps.destinations.get(destinationId);
  if (!destination) {
    return err(new ValidationError({ message: "Destination not found.", code: "TELEGRAM_DESTINATION_NOT_FOUND" }));
  }

  const chatResult = await deps.telegram.getChat(destination.telegramChatId);
  const now = new Date().toISOString();
  try {
    if (chatResult.ok) {
      const updated = await deps.destinations.update(destinationId, { verificationStatus: TelegramDestinationVerificationStatus.VERIFIED, verifiedAt: now });
      await recordDestinationAudit(deps.audit, actingUser, "destination_verified", destinationId);
      return ok(updated);
    }
    const updated = await deps.destinations.update(destinationId, { verificationStatus: TelegramDestinationVerificationStatus.FAILED, verifiedAt: undefined });
    await recordDestinationAudit(deps.audit, actingUser, "destination_verification_failed", destinationId, AuditOutcome.FAILURE, { reason: chatResult.error.message });
    return ok(updated);
  } catch (error) {
    return err(error as AppError);
  }
}

/** Only the publishing-relevant flags/name/enabled state — never `telegramChatId`/`type` (changing WHICH chat a destination points at is a new destination, not an edit) and never `verificationStatus`/`verifiedAt` (owned exclusively by `verifyDestination()`). */
export type DestinationSettingsPatch = Partial<Pick<TelegramDestination, "name" | "enabled" | "autoPublish" | "publishBookingCode" | "publishTicket" | "publishResults" | "publishWeeklyReport">>;

export async function updateDestinationSettings(deps: DestinationManagerDependencies, actingUser: AuthorizationContext, destinationId: UUID, patch: DestinationSettingsPatch): Promise<Result<TelegramDestination, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);
  try {
    const updated = await deps.destinations.update(destinationId, patch);
    await recordDestinationAudit(deps.audit, actingUser, "destination_updated", destinationId, AuditOutcome.SUCCESS, { patch });
    return ok(updated);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function disableDestination(deps: DestinationManagerDependencies, actingUser: AuthorizationContext, destinationId: UUID): Promise<Result<TelegramDestination, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);
  try {
    const updated = await deps.destinations.update(destinationId, { enabled: false });
    await recordDestinationAudit(deps.audit, actingUser, "destination_disabled", destinationId);
    return ok(updated);
  } catch (error) {
    return err(error as AppError);
  }
}

export async function listDestinations(deps: Pick<DestinationManagerDependencies, "destinations">, actingUser: AuthorizationContext): Promise<Result<readonly TelegramDestination[], AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);
  const destinations = await deps.destinations.list();
  return ok(destinations);
}

export async function getDestination(deps: Pick<DestinationManagerDependencies, "destinations">, actingUser: AuthorizationContext, destinationId: UUID): Promise<Result<TelegramDestination, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);
  const destination = await deps.destinations.get(destinationId);
  if (!destination) {
    return err(new ValidationError({ message: "Destination not found.", code: "TELEGRAM_DESTINATION_NOT_FOUND" }));
  }
  return ok(destination);
}
