import { err, ok, type AppError, type ISODateString, type Result } from "@sport-os/shared";
import { requireAdmin } from "../authorization.js";
import type { PlatformSettingsRepository } from "../owner-bootstrap.js";
import type { AuthorizationContext } from "../roles.js";

/**
 * Section 11 Part D — platform settings administration. "Do not create
 * a new configuration system" — the only genuinely PERSISTED, mutable
 * platform setting in this codebase today is the one-time OWNER
 * bootstrap claim (`platform_settings`, Section 03's
 * `PlatformSettingsRepository`), which already has its own atomic,
 * audited claim path (`claimAndPromoteOwner`) that this module does not
 * touch or duplicate — "preserve the Section 03 owner-bootstrap
 * protections."
 *
 * Everything else an admin might want to see here (environment, feature
 * flags, which integrations are configured) lives in `@sport-os/config`,
 * which this package does not depend on (adding that dependency only to
 * read a few booleans would be a needless new coupling). Instead, the
 * CALLER (an edge function or the bot, which already loaded a real
 * `AppConfig`) passes in a `PlatformSettingsSnapshotInput` — a type with
 * NO secret field on it at all, so there is no code path by which a bot
 * token, session-signing secret, or provider API key could ever flow
 * through this function. Every secret-like value is represented ONLY as
 * a `*Configured: boolean`, never its value — "configured / not
 * configured... never echo secret values."
 *
 * There is no settings MUTATION path here because there is no second
 * mutable setting to mutate — see `OPEN_QUESTIONS.md` for this explicit
 * scope decision.
 */

export interface PlatformSettingsSnapshotInput {
  readonly appEnv: string;
  readonly devAuthModeEnabled: boolean;
  readonly jobsEnabled: boolean;
  readonly sportyBetIntegrationMode: "manual" | "assisted" | "disabled";
  readonly telegramBotConfigured: boolean;
  readonly telegramMiniAppUrlConfigured: boolean;
  readonly footballDataProviderConfigured: boolean;
  readonly oddsProviderConfigured: boolean;
}

export interface PlatformSettingsSnapshot extends PlatformSettingsSnapshotInput {
  /** `true` means the one-time OWNER bootstrap claim has NOT happened yet — informational only, never a concurrency gate (see `PlatformSettingsRepository.isOwnerBootstrapped`'s own doc comment). */
  readonly ownerBootstrapAvailable: boolean;
  readonly generatedAt: ISODateString;
}

export async function getPlatformSettingsSnapshot(
  settingsRepo: PlatformSettingsRepository,
  actingUser: AuthorizationContext,
  input: PlatformSettingsSnapshotInput,
): Promise<Result<PlatformSettingsSnapshot, AppError>> {
  const denied = requireAdmin(actingUser);
  if (denied) return err(denied);

  const alreadyBootstrapped = await settingsRepo.isOwnerBootstrapped();
  return ok({ ...input, ownerBootstrapAvailable: !alreadyBootstrapped, generatedAt: new Date().toISOString() });
}
