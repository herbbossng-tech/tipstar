import { OperationalJobWorker } from "@sport-os/agents";
import { OperationalJobType } from "@sport-os/platform";
import type { SchedulerOptions } from "./scheduler.js";
import { StructuredLogger } from "@sport-os/shared";
import { loadWorkerConfig } from "./config.js";
import { buildWorkerContainer } from "./container.js";
import { runSchedulerTick } from "./scheduler.js";
import { WorkerRunner } from "./worker-runner.js";

/**
 * Section 12 Parts I/K/L — the standalone deployed process Section 11
 * flagged as missing (`OPEN_QUESTIONS.md` #33: "no standalone deployed
 * process runs OperationalJobWorker.runOnce() on a schedule"). This is
 * the smallest production-safe entrypoint that does: poll + claim +
 * execute every real job handler, and tick the minimal scheduler that
 * enqueues WEEKLY_REPORT_GENERATION/OPERATIONAL_HEALTH_CHECK jobs.
 *
 * Deployment model: one long-running Node process (`npm run start
 * --workspace=apps/worker`), any number of REPLICAS safe to run
 * concurrently — `claim_next_operational_job()`'s `FOR UPDATE SKIP
 * LOCKED` is what makes that safe, not anything in this file. See
 * docs/PRODUCTION_DEPLOYMENT.md.
 */

const config = loadWorkerConfig();
const logger = new StructuredLogger({ environment: config.app.env, service: "worker", minSeverity: config.app.logLevel });
const container = buildWorkerContainer(config, logger);

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
const SCHEDULER_TICK_MS = Number(process.env.WORKER_SCHEDULER_TICK_MS ?? 60_000);

const worker = new OperationalJobWorker({ jobs: container.jobs, handlers: container.handlers, audit: container.audit });
const runner = new WorkerRunner(worker, {
  jobTypes: [
    OperationalJobType.PERFORMANCE_SNAPSHOT,
    OperationalJobType.WEEKLY_REPORT_GENERATION,
    OperationalJobType.TELEGRAM_REPORT_PUBLICATION,
    OperationalJobType.OPERATIONAL_HEALTH_CHECK,
    OperationalJobType.FOOTBALL_REFERENCE_INGESTION,
    OperationalJobType.FOOTBALL_FIXTURE_INGESTION,
    OperationalJobType.FOOTBALL_ODDS_INGESTION,
  ],
  pollIntervalMs: POLL_INTERVAL_MS,
  logger,
});

// Section 13 — scheduling is config-driven, never a hard-coded aggressive
// default: an unset FOOTBALL_DATA_POLL_INTERVAL_SECONDS/ODDS_POLL_INTERVAL_SECONDS
// (or FOOTBALL_DATA_ENABLED=false/ODDS_ENABLED=false, or no competitions/
// sport keys configured) means these jobs are simply never enqueued.
const schedulerOptions: SchedulerOptions = {
  football: { enabled: config.providers.football.enabled, pollIntervalSeconds: config.providers.football.pollIntervalSeconds, hasSelection: config.providers.football.selectedIds.length > 0 },
  odds: { enabled: config.providers.odds.enabled, pollIntervalSeconds: config.providers.odds.pollIntervalSeconds, hasSelection: config.providers.odds.selectedIds.length > 0 },
};

const schedulerInterval = setInterval(() => {
  runSchedulerTick(container.schedulerDeps, new Date(), schedulerOptions).catch((error) => {
    logger.error("Scheduler tick failed unexpectedly", { error: error instanceof Error ? error.message : String(error) });
  });
}, SCHEDULER_TICK_MS);
// Run one tick immediately rather than waiting a full interval on a fresh start.
runSchedulerTick(container.schedulerDeps, new Date(), schedulerOptions).catch((error) => {
  logger.error("Initial scheduler tick failed unexpectedly", { error: error instanceof Error ? error.message : String(error) });
});

logger.info("Worker started", { pollIntervalMs: POLL_INTERVAL_MS, schedulerTickMs: SCHEDULER_TICK_MS, jobTypes: 7 });

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Received shutdown signal — stopping worker gracefully", { signal });
  clearInterval(schedulerInterval);
  runner.stop();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

runner
  .start()
  .then(() => {
    logger.info("Worker stopped");
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error("Worker crashed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
