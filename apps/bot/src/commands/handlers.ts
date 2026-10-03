import { getAgentOperationsSummary, listDestinations, verifyDestination, type DestinationManagerDependencies, type WeeklyReportRecord } from "@sport-os/agents";
import type { InvocationsRepository } from "@sport-os/agent-core";
import { requireAdmin, upsertAuthenticatedTelegramUser, type AppUser, type AuditService, type AuthorizationContext, type LicenseService, type OperationalJobsRepository, type UsersRepository } from "@sport-os/platform";
import type { UUID } from "@sport-os/shared";
import type { TelegramDestinationManager, TelegramService } from "@sport-os/telegram";
import type { CommandReply, TelegramCommandUser } from "./types.js";

/**
 * The minimal slice of `SupabaseWeeklyReportsRepository` the bot's
 * `/adminreports` command needs (Section 11 §T) — a narrow interface
 * rather than the concrete class, same reasoning as
 * `weekly-report-service.ts`'s `WeeklyReportsStore`: keeps this module
 * testable against a plain fake without pulling in Supabase types.
 */
export interface WeeklyReportsListing {
  listRecent(limit: number): Promise<readonly WeeklyReportRecord[]>;
}

/**
 * The real command handlers (Section 10 §32-§34). Every handler takes
 * an already-identified `TelegramCommandUser` — never a user id/role
 * read from a command argument or callback payload (§38's "bot command
 * security": `/status`/`/account`/`/destinations` query the backend for
 * the AUTHENTICATED Telegram identity only). Each one independently
 * re-resolves/re-authorizes through the same real
 * `@sport-os/platform`/`@sport-os/agents` services the Mini App and
 * agents use — there is no second, bot-only authorization path.
 *
 * "Only implement commands with actual backend contracts; honest
 * 'unavailable' responses for missing features, never fake data" —
 * `/football`/`/tickets`/`/performance` deliberately do NOT reimplement
 * Section 09's read-model queries a third time (Deno edge functions,
 * the React Mini App, and now this Node bot); they point at the Mini
 * App, which already has the real, tested implementation. `/aviator`
 * gives the same honest "not yet available" the Mini App gives, for the
 * same reason (no Aviator persistence exists — see OPEN_QUESTIONS.md
 * #26). See TELEGRAM_PUBLISHING_ARCHITECTURE.md's "Why the bot doesn't
 * re-implement Section 09's data screens" for the full rationale.
 */

export interface CommandDependencies {
  readonly users: UsersRepository;
  readonly licenseService: LicenseService;
  readonly destinations: TelegramDestinationManager;
  readonly telegram: TelegramService;
  readonly audit: AuditService;
  readonly appName: string;
  /** `undefined` means every "open the Mini App" reply below omits its button rather than fabricating a URL. */
  readonly miniAppUrl: string | undefined;
  /** Section 11 — operational visibility, OWNER/ADMIN only (see `requireAdmin()` calls in the `handleAdmin*` functions below). */
  readonly operationalJobs: OperationalJobsRepository;
  readonly weeklyReports: WeeklyReportsListing;
  readonly agentInvocations: InvocationsRepository;
}

/**
 * Identifies (and, on first contact, onboards) the calling Telegram
 * user — reusing the EXACT same `upsertAuthenticatedTelegramUser()`
 * Section 02/03 built for Mini App initData, with `authMode: "telegram"`
 * because this bot's own update-delivery channel (webhook secret token,
 * or the long-poll connection) IS the authentication boundary here, the
 * same way verified initData is the Mini App's. Called on every command,
 * not just `/start` — keeps the stored profile fresh and guarantees
 * every handler below has a resolved `AppUser`, never a raw Telegram id.
 */
async function identify(deps: CommandDependencies, from: TelegramCommandUser): Promise<AppUser> {
  const now = new Date().toISOString();
  return upsertAuthenticatedTelegramUser(deps.users, {
    telegramUserId: from.telegramUserId,
    firstName: from.firstName,
    lastName: from.lastName,
    username: from.username,
    languageCode: from.languageCode,
    isPremium: from.isPremium,
    authDate: now,
    verifiedAt: now,
    authMode: "telegram",
  });
}

function toAuthorizationContext(user: AppUser): AuthorizationContext {
  return { userId: user.id, role: user.role, status: user.status };
}

export async function handleStart(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  await identify(deps, from);
  return { text: `Welcome to ${deps.appName}. Send /help to see what this bot can do.` };
}

export async function handleHelp(): Promise<CommandReply> {
  return {
    text: [
      "/status — your account and license status",
      "/account — manage your account",
      "/football, /tickets, /performance — open the relevant Mini App screen",
      "/aviator — not yet available",
      "/destinations — list configured publishing destinations (admin only)",
      "/verifydestination <destination_id> — verify bot access to a destination (admin only)",
      "/admin — operations menu (admin only)",
      "/adminjobs — recent operational jobs (admin only)",
      "/adminreports — recent weekly reports (admin only)",
      "/adminagents — recent agent invocation failures (admin only)",
    ].join("\n"),
  };
}

export async function handleStatus(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const license = await deps.licenseService.getLicenseForUser(user.id);
  if (!license) {
    return { text: "No license is on file for your account. Contact an administrator." };
  }
  return {
    text: [`Role: ${user.role}`, `Account status: ${user.status}`, `License status: ${license.status}`, `Entitlements: ${license.entitlements.length > 0 ? license.entitlements.join(", ") : "none"}`].join("\n"),
  };
}

export async function handleAccount(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const status = await handleStatus(deps, from);
  if (!deps.miniAppUrl) return status;
  return { text: status.text, buttons: [{ text: "Manage account in Mini App", url: deps.miniAppUrl }] };
}

async function miniAppOnlyReply(deps: CommandDependencies, from: TelegramCommandUser, featureLabel: string): Promise<CommandReply> {
  await identify(deps, from);
  if (!deps.miniAppUrl) {
    return { text: `${featureLabel} is available in the Mini App.` };
  }
  return { text: `Open ${featureLabel} in the Mini App below.`, buttons: [{ text: `Open ${featureLabel}`, url: deps.miniAppUrl }] };
}

export function handleFootball(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  return miniAppOnlyReply(deps, from, "Football");
}

export function handleTickets(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  return miniAppOnlyReply(deps, from, "Tickets");
}

export function handlePerformance(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  return miniAppOnlyReply(deps, from, "Performance");
}

/** Mirrors the Mini App's own Aviator screen exactly — honest unavailability, never a fake signal (OPEN_QUESTIONS.md #26: no Aviator persistence exists yet). */
export async function handleAviator(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  await identify(deps, from);
  return { text: "Aviator is not yet available — no backend data source exists for it yet." };
}

export async function handleDestinations(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const result = await listDestinations({ destinations: deps.destinations }, toAuthorizationContext(user));
  if (!result.ok) return { text: result.error.message };
  if (result.value.length === 0) return { text: "No destinations are configured." };
  return {
    text: result.value
      .map((d) => `${d.name} (${d.type}) — ${d.enabled ? "enabled" : "disabled"}, ${d.verificationStatus ?? "unverified"} [${d.destinationId}]`)
      .join("\n"),
  };
}

export async function handleVerifyDestination(deps: CommandDependencies, from: TelegramCommandUser, destinationIdArg: string | undefined): Promise<CommandReply> {
  if (!destinationIdArg) {
    return { text: "Usage: /verifydestination <destination_id>" };
  }
  const user = await identify(deps, from);
  const depsForManager: DestinationManagerDependencies = { destinations: deps.destinations, telegram: deps.telegram, audit: deps.audit };
  const result = await verifyDestination(depsForManager, toAuthorizationContext(user), destinationIdArg as UUID);
  if (!result.ok) return { text: result.error.message };
  return { text: `Destination "${result.value.name}" is now ${result.value.verificationStatus ?? "unverified"}.` };
}

const ADMIN_LIST_LIMIT = 5;

/**
 * Admin operational commands (Section 11 §T). Every one of these
 * independently calls `requireAdmin()` on the SAME `AuthorizationContext`
 * every other admin surface in this codebase uses — never a bot-only
 * authorization path, and never a check skipped because "the user
 * already typed an admin-looking command." Per §T: a deep link into
 * the Mini App's `/admin` route is offered instead of trying to
 * reproduce its full tables as Telegram message text (mirrors
 * `miniAppOnlyReply()`'s existing precedent of pointing every
 * Mini-App-only feature at the same configured `miniAppUrl`).
 */
export async function handleAdmin(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const denied = requireAdmin(toAuthorizationContext(user));
  if (denied) return { text: denied.message };

  const text = ["Admin operations:", "/adminjobs — recent operational jobs", "/adminreports — recent weekly reports", "/adminagents — recent agent invocation failures"].join("\n");
  if (!deps.miniAppUrl) return { text };
  return { text, buttons: [{ text: "Open Admin in Mini App", url: deps.miniAppUrl }] };
}

export async function handleAdminJobs(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const denied = requireAdmin(toAuthorizationContext(user));
  if (denied) return { text: denied.message };

  const jobs = await deps.operationalJobs.listRecent({ limit: ADMIN_LIST_LIMIT });
  if (jobs.length === 0) return { text: "No operational jobs recorded yet." };
  return {
    text: jobs.map((job) => `${job.jobType} — ${job.status} (attempt ${job.attempts}/${job.maxAttempts})${job.lastError ? ` — ${job.lastError}` : ""}`).join("\n"),
  };
}

export async function handleAdminReports(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const denied = requireAdmin(toAuthorizationContext(user));
  if (denied) return { text: denied.message };

  const reports = await deps.weeklyReports.listRecent(ADMIN_LIST_LIMIT);
  if (reports.length === 0) return { text: "No weekly reports have been generated yet." };
  return {
    text: reports.map((report) => `${report.periodStart.slice(0, 10)} – ${report.periodEnd.slice(0, 10)} · ${report.ledgerMode} · v${report.reportVersion}`).join("\n"),
  };
}

export async function handleAdminAgents(deps: CommandDependencies, from: TelegramCommandUser): Promise<CommandReply> {
  const user = await identify(deps, from);
  const result = await getAgentOperationsSummary(deps.agentInvocations, toAuthorizationContext(user), undefined, 100);
  if (!result.ok) return { text: result.error.message };
  const summary = result.value;
  return {
    text: [`Invocations inspected: ${summary.totalInvocations}`, `Completed: ${summary.completedCount}`, `Running: ${summary.runningCount}`, `Failed: ${summary.failedCount} (retryable: ${summary.retryableFailureCount}, permanent: ${summary.permanentFailureCount})`].join("\n"),
  };
}
