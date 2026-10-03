import { AuditOutcome, isRetryableJobFailure, JobStatus, computeNextAttemptDelayMs, DEFAULT_JOB_LEASE_TIMEOUT_MS, type AuditService, type JobFailureCategory, type OperationalJobRecord, type OperationalJobType, type OperationalJobsRepository } from "@sport-os/platform";
import { generateId } from "@sport-os/shared";

/**
 * Section 11 Parts AD/AE/G — the job worker boundary.
 *
 *   FETCH QUEUED JOB -> CLAIM ATOMICALLY -> VALIDATE JOB TYPE
 *   -> RESOLVE SYSTEM/AUTHORIZED CONTEXT -> EXECUTE EXISTING DOMAIN SERVICE
 *   -> RECORD SUCCESS/FAILURE -> SCHEDULE RETRY IF SAFE -> AUDIT
 *
 * "Job payloads are NOT authorization... never trust a payload...
 * as proof of authorization." This worker never reads `job.createdBy`
 * or `job.payloadReference` as an authorization grant — every handler
 * below resolves its OWN authorization context independently (a real
 * `LicenseService`/`UsersRepository` check, or an explicit SYSTEM
 * context for a scheduler-created job), exactly the same way every
 * other service-role-backed operation in this codebase does.
 */

export type JobHandlerResult = { readonly ok: true } | { readonly ok: false; readonly category: JobFailureCategory; readonly message: string };

export interface JobHandler {
  readonly jobType: OperationalJobType;
  handle(job: OperationalJobRecord): Promise<JobHandlerResult>;
}

export interface OperationalJobWorkerDependencies {
  readonly jobs: OperationalJobsRepository;
  readonly handlers: readonly JobHandler[];
  readonly audit: AuditService;
  readonly leaseTimeoutMs?: number;
}

async function recordJobAudit(audit: AuditService, action: string, job: OperationalJobRecord, outcome: AuditOutcome, metadata: Record<string, unknown> = {}): Promise<void> {
  await audit.record({ actor: job.createdBy, action, resource: "operational_job", resourceId: job.jobId, outcome, requestId: generateId(), metadata: { jobType: job.jobType, attempts: job.attempts, ...metadata } });
}

export class OperationalJobWorker {
  private readonly leaseTimeoutMs: number;

  constructor(private readonly deps: OperationalJobWorkerDependencies) {
    this.leaseTimeoutMs = deps.leaseTimeoutMs ?? DEFAULT_JOB_LEASE_TIMEOUT_MS;
  }

  /** Claims and runs at most one job of the given type. Returns `"empty"` when nothing was eligible — the caller (a scheduled job-runner tick) decides how often to call this, never this class itself. */
  async runOnce(jobType: OperationalJobType): Promise<"claimed" | "empty"> {
    const job = await this.deps.jobs.claimNext(jobType, new Date().toISOString(), this.leaseTimeoutMs);
    if (!job) return "empty";

    await recordJobAudit(this.deps.audit, "job_claimed", job, AuditOutcome.SUCCESS);

    const handler = this.deps.handlers.find((h) => h.jobType === job.jobType);
    if (!handler) {
      // §F — "unknown job types must fail safely." This is PERMANENT:
      // no amount of retrying makes a missing handler appear.
      await this.deps.jobs.transitionTo(job.jobId, { status: JobStatus.FAILED, lastError: `No handler registered for job type "${job.jobType}".`, lastFailureCategory: "INVALID_PAYLOAD" });
      await recordJobAudit(this.deps.audit, "job_failed", job, AuditOutcome.FAILURE, { reason: "no_handler" });
      return "claimed";
    }

    try {
      const result = await handler.handle(job);
      if (result.ok) {
        await this.deps.jobs.transitionTo(job.jobId, { status: JobStatus.SUCCEEDED });
        await recordJobAudit(this.deps.audit, "job_succeeded", job, AuditOutcome.SUCCESS);
      } else {
        await this.recordFailureAndMaybeRetry(job, result.category, result.message);
      }
    } catch (error) {
      await this.recordFailureAndMaybeRetry(job, "UNKNOWN", error instanceof Error ? error.message : String(error));
    }
    return "claimed";
  }

  private async recordFailureAndMaybeRetry(job: OperationalJobRecord, category: JobFailureCategory, message: string): Promise<void> {
    const retryable = isRetryableJobFailure(category) && job.attempts < job.maxAttempts;
    if (retryable) {
      const nextAttemptAt = new Date(Date.now() + computeNextAttemptDelayMs(job.attempts)).toISOString();
      await this.deps.jobs.transitionTo(job.jobId, { status: JobStatus.QUEUED, lastError: message, lastFailureCategory: category, nextAttemptAt });
      await recordJobAudit(this.deps.audit, "job_retried", job, AuditOutcome.FAILURE, { category, message, nextAttemptAt });
    } else {
      await this.deps.jobs.transitionTo(job.jobId, { status: JobStatus.FAILED, lastError: message, lastFailureCategory: category });
      await recordJobAudit(this.deps.audit, "job_failed", job, AuditOutcome.FAILURE, { category, message, permanent: true });
    }
  }
}
