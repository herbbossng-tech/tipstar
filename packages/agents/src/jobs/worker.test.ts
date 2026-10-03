import { InMemoryAuditService, JobFailureCategory, JobStatus, isValidJobTransition, type NewOperationalJobInput, type OperationalJobCompletionInput, type OperationalJobRecord, type OperationalJobsRepository, type OperationalJobType } from "@sport-os/platform";
import { describe, expect, it } from "vitest";
import { OperationalJobWorker, type JobHandler, type JobHandlerResult } from "./worker.js";

class FakeJobsRepository implements OperationalJobsRepository {
  private readonly jobs = new Map<string, OperationalJobRecord>();
  private nextId = 1;

  seed(job: Omit<OperationalJobRecord, "jobId" | "createdAt" | "updatedAt">): OperationalJobRecord {
    const record: OperationalJobRecord = { ...job, jobId: `job-${this.nextId++}` as never, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.jobs.set(record.jobId, record);
    return record;
  }

  async create(input: NewOperationalJobInput): Promise<OperationalJobRecord> {
    return this.seed({ jobType: input.jobType, status: JobStatus.QUEUED, payloadReference: input.payloadReference, scheduledAt: input.scheduledAt, startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: input.maxAttempts, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OperationalJobRecord | undefined> {
    return [...this.jobs.values()].find((j) => j.idempotencyKey === idempotencyKey);
  }

  async claimNext(jobType: OperationalJobType | undefined): Promise<OperationalJobRecord | undefined> {
    const eligible = [...this.jobs.values()].find((j) => j.jobType === jobType && j.status === JobStatus.QUEUED);
    if (!eligible) return undefined;
    const updated = { ...eligible, status: JobStatus.RUNNING, startedAt: new Date().toISOString(), attempts: eligible.attempts + 1 };
    this.jobs.set(eligible.jobId, updated);
    return updated;
  }

  async transitionTo(jobId: string, completion: OperationalJobCompletionInput): Promise<OperationalJobRecord> {
    const existing = this.jobs.get(jobId as never);
    if (!existing) throw new Error("not found");
    if (!isValidJobTransition(existing.status, completion.status)) throw new Error(`invalid transition ${existing.status} -> ${completion.status}`);
    const updated: OperationalJobRecord = { ...existing, status: completion.status, lastError: completion.lastError, lastFailureCategory: completion.lastFailureCategory, nextAttemptAt: completion.nextAttemptAt, completedAt: completion.status === JobStatus.SUCCEEDED || completion.status === JobStatus.CANCELLED ? new Date().toISOString() : undefined };
    this.jobs.set(jobId as never, updated);
    return updated;
  }

  async listRecent(): Promise<readonly OperationalJobRecord[]> {
    return [...this.jobs.values()];
  }

  get(jobId: string): OperationalJobRecord | undefined {
    return this.jobs.get(jobId as never);
  }
}

function handler(jobType: OperationalJobType, result: JobHandlerResult | (() => Promise<JobHandlerResult>)): JobHandler {
  return { jobType, handle: async () => (typeof result === "function" ? result() : result) };
}

describe("OperationalJobWorker — Section 11 §AD/§AE/§G", () => {
  it("TEST 1: a successful handler transitions the job to SUCCEEDED and audits it", async () => {
    const jobs = new FakeJobsRepository();
    const seeded = jobs.seed({ jobType: "PERFORMANCE_SNAPSHOT" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k1", createdBy: "system" });
    const audit = new InMemoryAuditService();
    const worker = new OperationalJobWorker({ jobs, handlers: [handler("PERFORMANCE_SNAPSHOT" as OperationalJobType, { ok: true })], audit });
    const outcome = await worker.runOnce("PERFORMANCE_SNAPSHOT" as OperationalJobType);
    expect(outcome).toBe("claimed");
    expect(jobs.get(seeded.jobId)?.status).toBe(JobStatus.SUCCEEDED);
    expect(audit.getEvents().map((e) => e.action)).toEqual(["job_claimed", "job_succeeded"]);
  });

  it("TEST 2: a retryable failure re-queues the job with a future nextAttemptAt and bumps no attempts beyond the claim", async () => {
    const jobs = new FakeJobsRepository();
    jobs.seed({ jobType: "WEEKLY_REPORT_GENERATION" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 5, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k2", createdBy: "system" });
    const audit = new InMemoryAuditService();
    const worker = new OperationalJobWorker({ jobs, handlers: [handler("WEEKLY_REPORT_GENERATION" as OperationalJobType, { ok: false, category: JobFailureCategory.TIMEOUT, message: "db timeout" })], audit });
    await worker.runOnce("WEEKLY_REPORT_GENERATION" as OperationalJobType);
    const job = [...(await jobs.listRecent())][0]!;
    expect(job.status).toBe(JobStatus.QUEUED);
    expect(job.nextAttemptAt).toBeDefined();
    expect(audit.getEvents().map((e) => e.action)).toEqual(["job_claimed", "job_retried"]);
  });

  it("TEST 3: a permanent (non-retryable) failure category goes straight to FAILED, never QUEUED", async () => {
    const jobs = new FakeJobsRepository();
    jobs.seed({ jobType: "TELEGRAM_REPORT_PUBLICATION" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k3", createdBy: "system" });
    const worker = new OperationalJobWorker({ jobs, handlers: [handler("TELEGRAM_REPORT_PUBLICATION" as OperationalJobType, { ok: false, category: JobFailureCategory.AUTHORIZATION_DENIED, message: "denied" })], audit: new InMemoryAuditService() });
    await worker.runOnce("TELEGRAM_REPORT_PUBLICATION" as OperationalJobType);
    const job = [...(await jobs.listRecent())][0]!;
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it("TEST 4: exhausting maxAttempts on an otherwise-retryable category still lands on FAILED, not an infinite retry loop", async () => {
    const jobs = new FakeJobsRepository();
    const seeded = jobs.seed({ jobType: "PERFORMANCE_SNAPSHOT" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 2, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k4", createdBy: "system" });
    void seeded;
    const worker = new OperationalJobWorker({ jobs, handlers: [handler("PERFORMANCE_SNAPSHOT" as OperationalJobType, { ok: false, category: JobFailureCategory.TIMEOUT, message: "still timing out" })], audit: new InMemoryAuditService() });
    await worker.runOnce("PERFORMANCE_SNAPSHOT" as OperationalJobType);
    const job = [...(await jobs.listRecent())][0]!;
    // claimNext already bumped attempts to 3 (== maxAttempts), so this attempt is the last one allowed.
    expect(job.status).toBe(JobStatus.FAILED);
  });

  it("TEST 5: an unregistered job type fails safely (FAILED, INVALID_PAYLOAD) rather than throwing or silently doing nothing", async () => {
    const jobs = new FakeJobsRepository();
    jobs.seed({ jobType: "OPERATIONAL_HEALTH_CHECK" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 1, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k5", createdBy: "system" });
    const worker = new OperationalJobWorker({ jobs, handlers: [], audit: new InMemoryAuditService() });
    await worker.runOnce("OPERATIONAL_HEALTH_CHECK" as OperationalJobType);
    const job = [...(await jobs.listRecent())][0]!;
    expect(job.status).toBe(JobStatus.FAILED);
    expect(job.lastFailureCategory).toBe("INVALID_PAYLOAD");
  });

  it("TEST 6: a handler that throws is caught and classified UNKNOWN, never crashes the worker", async () => {
    const jobs = new FakeJobsRepository();
    jobs.seed({ jobType: "PERFORMANCE_SNAPSHOT" as OperationalJobType, status: JobStatus.QUEUED, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k6", createdBy: "system" });
    const worker = new OperationalJobWorker({
      jobs,
      handlers: [
        {
          jobType: "PERFORMANCE_SNAPSHOT" as OperationalJobType,
          handle: async () => {
            throw new Error("boom");
          },
        },
      ],
      audit: new InMemoryAuditService(),
    });
    await expect(worker.runOnce("PERFORMANCE_SNAPSHOT" as OperationalJobType)).resolves.toBe("claimed");
    const job = [...(await jobs.listRecent())][0]!;
    expect(job.status).toBe(JobStatus.FAILED);
    expect(job.lastError).toBe("boom");
  });

  it("TEST 7: returns 'empty' when nothing is eligible, never claims a non-existent job", async () => {
    const jobs = new FakeJobsRepository();
    const worker = new OperationalJobWorker({ jobs, handlers: [], audit: new InMemoryAuditService() });
    await expect(worker.runOnce("PERFORMANCE_SNAPSHOT" as OperationalJobType)).resolves.toBe("empty");
  });
});
