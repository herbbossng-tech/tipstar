import { NotImplementedError, type ISODateString, type UUID } from "@sport-os/shared";

/**
 * Section 11 Parts E/F/G/I/AC/AD/AE — the durable job abstraction. A
 * simple, reliable Postgres-backed job runner, NOT a distributed queue
 * — "Do NOT add an unnecessary external queue provider."
 *
 * Mirrors `@sport-os/agent-core/invocation.ts`'s own
 * `isValidInvocationTransition` pattern exactly (this package cannot
 * depend on `agent-core`'s invocation semantics directly without
 * creating an unwanted coupling between "an agent invocation" and "an
 * operational job" — they are deliberately separate state machines,
 * even though both share the same "validated transition table" shape).
 */

export const JobStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/**
 *   QUEUED -> RUNNING | CANCELLED
 *   RUNNING -> SUCCEEDED | FAILED | CANCELLED | QUEUED   (the last one is the worker's OWN automatic retry of a transient failure — one round trip, no FAILED waypoint)
 *   FAILED -> QUEUED   (an explicit ADMIN retry action of a job that already landed on permanent FAILED — §S "retry action only when permitted")
 *   SUCCEEDED|CANCELLED -> (terminal, no further transition)
 */
const ALLOWED_JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [JobStatus.QUEUED]: [JobStatus.RUNNING, JobStatus.CANCELLED],
  [JobStatus.RUNNING]: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.QUEUED],
  [JobStatus.FAILED]: [JobStatus.QUEUED],
  [JobStatus.SUCCEEDED]: [],
  [JobStatus.CANCELLED]: [],
};

export function isValidJobTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_JOB_TRANSITIONS[from].includes(to);
}

/**
 * Closed, locked set (§F) — "only implement job types for which there
 * is an actual service contract... unknown job types must fail safely."
 * A real worker rejects anything outside this set rather than guessing.
 */
export const OperationalJobType = {
  WEEKLY_REPORT_GENERATION: "WEEKLY_REPORT_GENERATION",
  TELEGRAM_REPORT_PUBLICATION: "TELEGRAM_REPORT_PUBLICATION",
  PERFORMANCE_SNAPSHOT: "PERFORMANCE_SNAPSHOT",
  OPERATIONAL_HEALTH_CHECK: "OPERATIONAL_HEALTH_CHECK",
} as const;
export type OperationalJobType = (typeof OperationalJobType)[keyof typeof OperationalJobType];

/**
 * Safe-retry classification (§I) — mirrors `@sport-os/agent-core`'s own
 * RETRYABLE_FAILURE/PERMANENT_FAILURE split conceptually, as a job-level
 * failure taxonomy. "Do not retry: authorization failures, invalid
 * payload, invalid state transitions, policy rejection, license denial,
 * permanent Telegram errors, settlement decisions, financial execution
 * actions."
 */
export const JobFailureCategory = {
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  INTEGRATION_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  TRANSIENT_DEPENDENCY_FAILURE: "TRANSIENT_DEPENDENCY_FAILURE",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  POLICY_REJECTED: "POLICY_REJECTED",
  LICENSE_DENIED: "LICENSE_DENIED",
  PERMANENT_INTEGRATION_ERROR: "PERMANENT_INTEGRATION_ERROR",
  UNKNOWN: "UNKNOWN",
} as const;
export type JobFailureCategory = (typeof JobFailureCategory)[keyof typeof JobFailureCategory];

const RETRYABLE_JOB_FAILURE_CATEGORIES: ReadonlySet<JobFailureCategory> = new Set([
  JobFailureCategory.DATA_UNAVAILABLE,
  JobFailureCategory.TIMEOUT,
  JobFailureCategory.INTEGRATION_UNAVAILABLE,
  JobFailureCategory.TRANSIENT_DEPENDENCY_FAILURE,
]);

/** Pure, deterministic — the SAME category always resolves the SAME way. Never retries an authorization/policy/license/permanent-integration/invalid-payload/invalid-transition failure, no matter how many attempts remain. */
export function isRetryableJobFailure(category: JobFailureCategory): boolean {
  return RETRYABLE_JOB_FAILURE_CATEGORIES.has(category);
}

/** Exponential backoff, in milliseconds, capped — the same shape `TelegramBotApiService`'s own retry already uses (Section 10), applied here at the job level. `attempt` is 1-based (the attempt that just failed). */
export function computeNextAttemptDelayMs(attempt: number, baseMs = 1000, maxMs = 15 * 60 * 1000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** A RUNNING job whose lease has expired (the worker that claimed it crashed or hung) is stale and eligible to be reclaimed — §E's "a stale RUNNING job can be identified/recovered according to a documented lease/timeout rule." */
export function isStaleRunningJob(startedAt: ISODateString | undefined, now: Date, leaseTimeoutMs: number): boolean {
  if (!startedAt) return false;
  return now.getTime() - new Date(startedAt).getTime() > leaseTimeoutMs;
}

/** The default lease timeout every worker/claim query uses unless a caller has a documented reason to override it. */
export const DEFAULT_JOB_LEASE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * One durable job record (§E). `payload` is a REFERENCE (an id, a
 * period string), never a secret or an arbitrary sensitive blob — "do
 * not store arbitrary sensitive payloads... store references rather
 * than secrets."
 */
export interface OperationalJobRecord {
  readonly jobId: UUID;
  readonly jobType: OperationalJobType;
  readonly status: JobStatus;
  readonly payloadReference: Readonly<Record<string, string | number | boolean>>;
  readonly scheduledAt: ISODateString;
  readonly startedAt: ISODateString | undefined;
  readonly completedAt: ISODateString | undefined;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: ISODateString | undefined;
  readonly lastError: string | undefined;
  readonly lastFailureCategory: JobFailureCategory | undefined;
  readonly idempotencyKey: string;
  /** The real actor who caused this job to exist — a user id, or the literal string `"system"` for a scheduler-created job (§G: "system-generated jobs must use an explicit SYSTEM actor/context"). Never trusted as authorization by itself; a worker resolves its own authorization context independently (see JOBS_AND_SCHEDULING.md). */
  readonly createdBy: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface NewOperationalJobInput {
  readonly jobType: OperationalJobType;
  readonly payloadReference: Readonly<Record<string, string | number | boolean>>;
  readonly scheduledAt: ISODateString;
  readonly maxAttempts: number;
  readonly idempotencyKey: string;
  readonly createdBy: string;
}

export interface OperationalJobCompletionInput {
  readonly status: JobStatus;
  readonly lastError?: string;
  readonly lastFailureCategory?: JobFailureCategory;
  readonly nextAttemptAt?: ISODateString;
}

/**
 * `claimNext` is the ONE atomic entry point every worker uses — "no
 * duplicate execution caused by worker retries... concurrent workers
 * cannot execute the same job simultaneously." The real, Supabase-
 * backed implementation (`SupabaseOperationalJobsRepository` in
 * `@sport-os/agents`) performs this as a single `UPDATE ... WHERE
 * status = 'QUEUED' ... RETURNING` (or the stale-RUNNING-reclaim
 * variant), never a separate read-then-write.
 */
export interface OperationalJobsRepository {
  create(input: NewOperationalJobInput): Promise<OperationalJobRecord>;
  findByIdempotencyKey(idempotencyKey: string): Promise<OperationalJobRecord | undefined>;
  /** Atomically claims one eligible job (QUEUED and due, OR stale RUNNING past its lease) and marks it RUNNING — `undefined` when none is eligible right now. */
  claimNext(jobType: OperationalJobType | undefined, now: ISODateString, leaseTimeoutMs: number): Promise<OperationalJobRecord | undefined>;
  transitionTo(jobId: UUID, completion: OperationalJobCompletionInput): Promise<OperationalJobRecord>;
  listRecent(params: { readonly jobType?: OperationalJobType; readonly status?: JobStatus; readonly limit: number }): Promise<readonly OperationalJobRecord[]>;
}

export class NotImplementedOperationalJobsRepository implements OperationalJobsRepository {
  async create(): Promise<OperationalJobRecord> {
    throw new NotImplementedError("OperationalJobsRepository.create");
  }
  async findByIdempotencyKey(): Promise<OperationalJobRecord | undefined> {
    throw new NotImplementedError("OperationalJobsRepository.findByIdempotencyKey");
  }
  async claimNext(): Promise<OperationalJobRecord | undefined> {
    throw new NotImplementedError("OperationalJobsRepository.claimNext");
  }
  async transitionTo(): Promise<OperationalJobRecord> {
    throw new NotImplementedError("OperationalJobsRepository.transitionTo");
  }
  async listRecent(): Promise<readonly OperationalJobRecord[]> {
    throw new NotImplementedError("OperationalJobsRepository.listRecent");
  }
}
