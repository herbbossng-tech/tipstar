import { OperationalJobType, type NewOperationalJobInput, type OperationalJobsRepository } from "@sport-os/platform";
import type { Logger } from "@sport-os/shared";

/**
 * Section 12 Part K — the minimal, production-safe scheduler Section 11
 * identified as missing (`OPEN_QUESTIONS.md` #33). NOT a generic cron
 * platform: it supports exactly two typed, durable scheduled
 * operations (weekly report generation, operational health checks),
 * both resolved to a deterministic idempotency key so a duplicate tick
 * — the scheduler running twice in the same period, or running every
 * few minutes all week — can NEVER create a second job for the same
 * period/bucket. It only ever ENQUEUES a durable `operational_jobs`
 * row; it never executes domain work itself, never bypasses
 * authorization, agent orchestration, or the execution gate — the
 * worker (`OperationalJobWorker`) and its handlers do that, exactly
 * the same way an admin-enqueued job does.
 *
 * Explicit timezone decision (Part K: "timezone behavior must be
 * explicit"): every computation here is UTC. This is the same
 * convention every timestamp in this codebase already uses
 * (`timestamptz`, ISO 8601 with no local-timezone assumption anywhere
 * else in the platform) — there is no separate "platform default
 * timezone" to configure because none of this codebase's other time
 * handling needs one. A later requirement for a non-UTC reporting
 * calendar would need to be resolved explicitly, not silently assumed.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The most recent Monday 00:00:00.000 UTC at or before `now`. */
export function startOfIsoWeekUtc(now: Date): Date {
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoDayOfWeek = utcMidnight.getUTCDay() === 0 ? 7 : utcMidnight.getUTCDay(); // 1=Mon ... 7=Sun
  return new Date(utcMidnight.getTime() - (isoDayOfWeek - 1) * 24 * 60 * 60 * 1000);
}

/**
 * The target period for a weekly report job created "now" — always the
 * most recently COMPLETED ISO week (Mon 00:00:00 UTC to the following
 * Mon 00:00:00 UTC), never the week still in progress. Deterministic
 * for any `now` within the same ISO week, so the idempotency key never
 * changes no matter how many times this is called that week.
 */
export function currentWeeklyReportPeriod(now: Date): { readonly periodStart: string; readonly periodEnd: string } {
  const currentWeekStart = startOfIsoWeekUtc(now);
  const periodStart = new Date(currentWeekStart.getTime() - WEEK_MS);
  const periodEnd = new Date(currentWeekStart.getTime() - 1); // 23:59:59.999 the prior Sunday
  return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
}

/** Rounds `now` down to the start of its `bucketMinutes`-minute bucket, UTC. Two ticks landing in the same bucket resolve to the identical idempotency key. */
export function healthCheckBucketKey(now: Date, bucketMinutes: number): string {
  const bucketMs = bucketMinutes * 60 * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
  return bucketStart.toISOString();
}

export interface SchedulerDependencies {
  readonly jobs: OperationalJobsRepository;
  readonly logger: Logger;
}

export interface SchedulerOptions {
  /** How often health-check buckets are created. Defaults to 15 minutes. */
  readonly healthCheckBucketMinutes?: number;
  /** The ledger mode weekly reports are generated for. Defaults to LIVE — PAPER reporting, if ever needed, is a separate explicit schedule, never silently combined. */
  readonly weeklyReportLedgerMode?: "LIVE" | "PAPER";
}

/**
 * One scheduler "tick" — call this on an interval (see `index.ts`).
 * Idempotent by construction: enqueuing is always `findByIdempotencyKey`
 * first, `create` only if absent, so calling this every minute, every
 * hour, or twice concurrently all converge on the same single job per
 * period/bucket.
 */
export async function runSchedulerTick(deps: SchedulerDependencies, now: Date, options: SchedulerOptions = {}): Promise<void> {
  const ledgerMode = options.weeklyReportLedgerMode ?? "LIVE";
  const bucketMinutes = options.healthCheckBucketMinutes ?? 15;

  const { periodStart, periodEnd } = currentWeeklyReportPeriod(now);
  await enqueueIfAbsent(deps, {
    jobType: OperationalJobType.WEEKLY_REPORT_GENERATION,
    payloadReference: { periodStart, periodEnd, ledgerMode },
    idempotencyKey: `weekly-report:${periodStart}:${periodEnd}:${ledgerMode}`,
    scheduledAt: now.toISOString(),
    maxAttempts: 3,
    createdBy: "system",
  });

  const bucket = healthCheckBucketKey(now, bucketMinutes);
  await enqueueIfAbsent(deps, {
    jobType: OperationalJobType.OPERATIONAL_HEALTH_CHECK,
    payloadReference: { bucket },
    idempotencyKey: `operational-health-check:${bucket}`,
    scheduledAt: now.toISOString(),
    maxAttempts: 1,
    createdBy: "system",
  });
}

async function enqueueIfAbsent(deps: SchedulerDependencies, input: NewOperationalJobInput): Promise<void> {
  const existing = await deps.jobs.findByIdempotencyKey(input.idempotencyKey);
  if (existing) return;
  try {
    await deps.jobs.create(input);
    deps.logger.info("Scheduler enqueued a job", { jobType: input.jobType, idempotencyKey: input.idempotencyKey });
  } catch (error) {
    // A concurrent scheduler tick (or another instance) may have won
    // the race between our findByIdempotencyKey check and this create()
    // call — the unique index on idempotency_key is the real guarantee;
    // this is just the non-atomic check-then-create path tolerating
    // that race rather than treating it as a real failure.
    deps.logger.warn("Scheduler enqueue raced with a concurrent create (tolerated — idempotency key already satisfied)", { jobType: input.jobType, idempotencyKey: input.idempotencyKey, error: error instanceof Error ? error.message : String(error) });
  }
}
