import { SupabaseTelegramDestinationManager } from "@sport-os/agents";
import type { AppConfig } from "@sport-os/config";
import {
  createServiceRoleClient,
  DatabaseLicenseService,
  SupabaseAuditService,
  SupabaseLicenseEntitlementsRepository,
  SupabaseLicenseLimitsRepository,
  SupabaseLicensesRepository,
  SupabaseUsersRepository,
} from "@sport-os/platform";
import { ConfigurationError } from "@sport-os/shared";
import { TelegramBotApiService } from "@sport-os/telegram";
import type { CommandDependencies } from "./commands/handlers.js";

/**
 * Wires the bot's real, Supabase-backed dependencies (Section 10). This
 * is the FIRST Node-runtime caller of `@sport-os/platform`'s real
 * services directly — unlike the Deno edge functions (Section 02-09),
 * `apps/bot` is a genuine Node process and can import workspace
 * TypeScript packages without a bundler/runtime boundary, so nothing
 * here is re-implemented against a `_shared/` copy the way the edge
 * functions have to.
 *
 * Always uses a SERVICE-ROLE client (bypasses RLS entirely) — every
 * command handler built on top of this container performs its OWN
 * authorization check before using it (see `commands/handlers.ts`),
 * exactly like every other service-role caller in this codebase.
 */
export function buildBotContainer(config: AppConfig): CommandDependencies {
  if (!config.telegram.botToken) {
    throw new ConfigurationError({ message: "TELEGRAM_BOT_TOKEN is required." });
  }
  if (!config.supabase.serviceRoleKey) {
    throw new ConfigurationError({ message: "SUPABASE_SERVICE_ROLE_KEY is required to run the bot." });
  }

  const client = createServiceRoleClient({ supabaseUrl: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey });

  const users = new SupabaseUsersRepository(client);
  const licenseService = new DatabaseLicenseService(new SupabaseLicensesRepository(client), new SupabaseLicenseEntitlementsRepository(client), new SupabaseLicenseLimitsRepository(client));
  const audit = new SupabaseAuditService(client);
  const destinations = new SupabaseTelegramDestinationManager(client);
  const telegram = new TelegramBotApiService({ botToken: config.telegram.botToken, retryLimit: config.telegram.publishRetryLimit, timeoutMs: config.telegram.publishTimeoutMs });

  return { users, licenseService, destinations, telegram, audit, appName: config.app.name, miniAppUrl: config.telegram.miniAppUrl };
}
