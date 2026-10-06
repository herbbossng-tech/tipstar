import { AgentOrchestrator, InMemoryIdempotencyStore } from "@sport-os/agent-core";
import {
  buildFootballIngestionDependencies,
  FootballFixtureIngestionJobHandler,
  FootballOddsIngestionJobHandler,
  FootballReferenceIngestionJobHandler,
  OperationalHealthCheckJobHandler,
  PerformanceSnapshotJobHandler,
  SupabaseInvocationsRepository,
  SupabaseOperationalJobsRepository,
  SupabasePerformanceLedgerRepository,
  SupabaseTelegramDestinationManager,
  SupabaseTelegramPublicationsRepository,
  SupabaseWeeklyReportsRepository,
  TelegramChannelManagementAgent,
  TelegramReportPublicationJobHandler,
  WeeklyReportGenerationJobHandler,
  type JobHandler,
  PublishingAuthorizer,
} from "@sport-os/agents";
import type { AppConfig } from "@sport-os/config";
import { ODDS_API_PROVIDER_NAME, SPORTMONKS_PROVIDER_NAME, SupabaseFixtureExternalIdentitiesRepository, type ProviderConfig } from "@sport-os/football-engine";
import {
  createServiceRoleClient,
  DatabaseLicenseService,
  Entitlement,
  SupabaseAuditService,
  SupabaseLicenseEntitlementsRepository,
  SupabaseLicenseLimitsRepository,
  SupabaseLicensesRepository,
  SupabaseUsersRepository,
  type OperationalJobsRepository,
} from "@sport-os/platform";
import { ConfigurationError, type Logger } from "@sport-os/shared";
import { TelegramBotApiService } from "@sport-os/telegram";
import type { SchedulerDependencies } from "./scheduler.js";

/**
 * Wires the worker's real, Supabase-backed dependencies (Section 12).
 * Always a SERVICE-ROLE client — every mutation this process performs
 * is already independently authorized by the job system itself
 * (`claim_next_operational_job()` is the only write path for claiming;
 * `PublishingAuthorizer` re-derives real identity/license/entitlement
 * for every Telegram publication dispatch, see below) — exactly the
 * same "service-role client, app-layer authorization" pattern
 * `apps/bot`'s container already established.
 */
export interface WorkerContainer {
  readonly jobs: OperationalJobsRepository;
  readonly handlers: readonly JobHandler[];
  readonly audit: SupabaseAuditService;
  readonly logger: Logger;
  readonly schedulerDeps: SchedulerDependencies;
}

export function buildWorkerContainer(config: AppConfig, logger: Logger): WorkerContainer {
  if (!config.supabase.serviceRoleKey) {
    throw new ConfigurationError({ message: "SUPABASE_SERVICE_ROLE_KEY is required to run the worker." });
  }

  const client = createServiceRoleClient({ supabaseUrl: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey });

  const jobs = new SupabaseOperationalJobsRepository(client);
  const weeklyReports = new SupabaseWeeklyReportsRepository(client);
  const performanceLedger = new SupabasePerformanceLedgerRepository(client);
  const invocations = new SupabaseInvocationsRepository(client);
  const audit = new SupabaseAuditService(client);
  const users = new SupabaseUsersRepository(client);
  const licenseService = new DatabaseLicenseService(new SupabaseLicensesRepository(client), new SupabaseLicenseEntitlementsRepository(client), new SupabaseLicenseLimitsRepository(client));

  // Telegram report publication dispatch — the REAL orchestrator +
  // channel agent + publishing authorizer, never a direct Telegram API
  // call from this process (Section 11 Part N). `PublishingAuthorizer`
  // requires a REAL identity/license/entitlement on `job.createdBy` —
  // see JOBS_AND_SCHEDULING.md's "Who authorizes a publication" for why
  // this worker never auto-publishes a scheduler-created ("system")
  // job, only an admin-requested one.
  const destinations = new SupabaseTelegramDestinationManager(client);
  const publications = new SupabaseTelegramPublicationsRepository(client);
  const telegram = config.telegram.botToken ? new TelegramBotApiService({ botToken: config.telegram.botToken, retryLimit: config.telegram.publishRetryLimit, timeoutMs: config.telegram.publishTimeoutMs }) : undefined;
  const channelAgent = telegram ? new TelegramChannelManagementAgent({ destinations, telegram, publications }) : undefined;
  const publishingAuthorizer = new PublishingAuthorizer({ users, licenseService, resolveRequiredEntitlement: () => Entitlement.WEEKLY_REPORTS });
  const orchestrator = new AgentOrchestrator({ invocations, idempotency: new InMemoryIdempotencyStore(), executionAuthorizer: publishingAuthorizer, auditSink: audit });

  const handlers: JobHandler[] = [
    new PerformanceSnapshotJobHandler(client, performanceLedger),
    new WeeklyReportGenerationJobHandler({ ledger: performanceLedger, reports: weeklyReports }),
    new OperationalHealthCheckJobHandler({
      operationalJobs: jobs,
      agentInvocations: invocations,
      performanceLedger,
      // Section 12 Part Y — resolves the previously-UNKNOWN settlement
      // probe with a real, bounded read against `settlements` itself
      // (never reusing the reporting probe's result as a stand-in for
      // a signal it doesn't actually test).
      settlementsConnectivityProbe: async () => {
        const { error } = await client.from("settlements").select("id").limit(1);
        if (error) throw new Error(error.message);
      },
      audit,
      telegramConfigured: Boolean(config.telegram.botToken),
      footballDataProviderConfigured: config.providers.football.enabled,
      oddsProviderConfigured: config.providers.odds.enabled,
      aviatorDataConfigured: Boolean(config.providers.aviator.name),
    }),
  ];
  // Section 13 — real football data provider ingestion. ProviderConfig's
  // own `provider` field is hard-coded to each adapter's canonical name
  // here (not read from FOOTBALL_DATA_PROVIDER/ODDS_PROVIDER) since this
  // container wires up exactly one concrete adapter per provider slot,
  // not a provider registry — see FOOTBALL_PROVIDER_INTEGRATION.md.
  const footballProviderConfig: ProviderConfig = {
    provider: SPORTMONKS_PROVIDER_NAME,
    enabled: config.providers.football.enabled,
    baseUrl: config.providers.football.baseUrl,
    apiKey: config.providers.football.apiKey,
    timeoutMs: config.providers.football.timeoutMs,
    maxRetries: config.providers.football.maxRetries,
    rateLimitPerMinute: config.providers.football.rateLimitPerMinute,
    pollIntervalSeconds: config.providers.football.pollIntervalSeconds,
  };
  const oddsProviderConfig: ProviderConfig = {
    provider: ODDS_API_PROVIDER_NAME,
    enabled: config.providers.odds.enabled,
    baseUrl: config.providers.odds.baseUrl,
    apiKey: config.providers.odds.apiKey,
    timeoutMs: config.providers.odds.timeoutMs,
    maxRetries: config.providers.odds.maxRetries,
    rateLimitPerMinute: config.providers.odds.rateLimitPerMinute,
    pollIntervalSeconds: config.providers.odds.pollIntervalSeconds,
  };
  const footballIngestionDeps = buildFootballIngestionDependencies(client);
  if (footballProviderConfig.enabled && config.providers.football.selectedIds.length > 0) {
    handlers.push(new FootballReferenceIngestionJobHandler(footballIngestionDeps, footballProviderConfig, config.providers.football.selectedIds));
    handlers.push(new FootballFixtureIngestionJobHandler(footballIngestionDeps, footballProviderConfig, config.providers.football.selectedIds));
  } else {
    logger.warn("Football data provider disabled or no competitions configured (FOOTBALL_DATA_ENABLED/FOOTBALL_DATA_COMPETITION_IDS) — FOOTBALL_REFERENCE_INGESTION/FOOTBALL_FIXTURE_INGESTION jobs will fail safely (no handler registered) rather than silently succeeding.");
  }
  if (oddsProviderConfig.enabled && config.providers.odds.selectedIds.length > 0) {
    handlers.push(new FootballOddsIngestionJobHandler(footballIngestionDeps, new SupabaseFixtureExternalIdentitiesRepository(client), oddsProviderConfig, config.providers.odds.selectedIds));
  } else {
    logger.warn("Odds provider disabled or no sport keys configured (ODDS_ENABLED/ODDS_SPORT_KEYS) — FOOTBALL_ODDS_INGESTION jobs will fail safely (no handler registered) rather than silently succeeding.");
  }

  if (channelAgent) {
    handlers.push(new TelegramReportPublicationJobHandler({ orchestrator, channelAgent, reports: weeklyReports }));
  } else {
    logger.warn("TELEGRAM_BOT_TOKEN not configured — TELEGRAM_REPORT_PUBLICATION jobs will fail safely (no handler registered) rather than silently succeeding.");
  }

  return { jobs, handlers, audit, logger, schedulerDeps: { jobs, logger } };
}
