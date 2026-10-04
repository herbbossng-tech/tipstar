import { OperationalJobWorker, WeeklyReportGenerationJobHandler, type PerformanceLedgerReader, type WeeklyReportsStore } from "@sport-os/agents";
import { InMemoryAuditService, type NewOperationalJobInput, type OperationalJobRecord, type OperationalJobsRepository } from "@sport-os/platform";
import { LedgerMode, type PerformanceLedgerEntry } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { runSchedulerTick } from "./scheduler.js";

/**
 * Section 12 Part AF — CHAIN 4: Scheduler -> Job -> Worker -> Report.
 * Co-located in `apps/worker` (rather than `tests/e2e`) because it
 * needs this app's own `runSchedulerTick()` — a real cross-module
 * composition of the scheduler, the durable job queue, the atomic
 * worker, and the real `generateWeeklyReport()` service, with only the
 * Postgres-backed repository swapped for an in-memory fake.
 */

class FakeJobsRepository implements OperationalJobsRepository {
  private readonly jobs = new Map<string, OperationalJobRecord>();
  async create(input: NewOperationalJobInput): Promise<OperationalJobRecord> {
    const record: OperationalJobRecord = { jobId: `job-${this.jobs.size + 1}` as never, jobType: input.jobType, status: "QUEUED", payloadReference: input.payloadReference, scheduledAt: input.scheduledAt, startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: input.maxAttempts, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy, createdAt: input.scheduledAt, updatedAt: input.scheduledAt };
    this.jobs.set(record.jobId, record);
    return record;
  }
  async findByIdempotencyKey(idempotencyKey: string): Promise<OperationalJobRecord | undefined> {
    return [...this.jobs.values()].find((j) => j.idempotencyKey === idempotencyKey);
  }
  async claimNext(jobType?: string): Promise<OperationalJobRecord | undefined> {
    const eligible = [...this.jobs.values()].find((j) => j.jobType === jobType && j.status === "QUEUED");
    if (!eligible) return undefined;
    const updated = { ...eligible, status: "RUNNING" as const, startedAt: new Date().toISOString(), attempts: eligible.attempts + 1 };
    this.jobs.set(eligible.jobId, updated);
    return updated;
  }
  async transitionTo(jobId: string, completion: { status: string; lastError?: string; lastFailureCategory?: string }): Promise<OperationalJobRecord> {
    const existing = this.jobs.get(jobId)!;
    const updated = { ...existing, status: completion.status as never, lastError: completion.lastError, lastFailureCategory: completion.lastFailureCategory as never, completedAt: completion.status === "SUCCEEDED" ? new Date().toISOString() : undefined };
    this.jobs.set(jobId, updated);
    return updated;
  }
  async listRecent(): Promise<readonly OperationalJobRecord[]> {
    return [...this.jobs.values()];
  }
}

describe("CHAIN 4 — scheduler tick -> durable job -> atomic worker claim -> real weekly report generation", () => {
  it("a scheduler tick enqueues a real WEEKLY_REPORT_GENERATION job, and the real worker claims and executes it to a real, finalized report", async () => {
    const jobs = new FakeJobsRepository();
    const audit = new InMemoryAuditService();

    await runSchedulerTick({ jobs, logger: { debug() {}, info() {}, warn() {}, error() {}, withRequestId: () => ({ debug() {}, info() {}, warn() {}, error() {}, withRequestId: () => undefined as never }) } as never }, new Date("2026-02-02T09:00:00Z"));
    const queued = (await jobs.listRecent()).find((j) => j.jobType === "WEEKLY_REPORT_GENERATION");
    expect(queued?.status).toBe("QUEUED");

    const entry: PerformanceLedgerEntry = { periodStart: queued!.payloadReference.periodStart as string, periodEnd: queued!.payloadReference.periodEnd as string, ledgerMode: LedgerMode.LIVE, sport: "football", league: undefined, market: undefined, modelVersion: undefined, decisionPolicyVersion: undefined, ticketType: undefined, ticketCount: 3, legCount: 3, executedTicketCount: 3, settledTicketCount: 3, wins: 2, losses: 1, voids: 0, pushes: 0, pending: 0, actualStake: { amount: 30, currency: "NGN" }, actualPayout: { amount: 51, currency: "NGN" }, actualPnl: { amount: 21, currency: "NGN" }, roi: 0.7, expectedEv: 0.1, maxDrawdown: null, longestLosingStreak: 1, sampleSize: 3 };
    const ledger: PerformanceLedgerReader = { listForPeriod: async () => [entry] };
    const reportsStore = new Map<string, unknown>();
    const reports: WeeklyReportsStore = {
      findByIdempotencyKey: async (key) => reportsStore.get(key) as never,
      findCurrentForPeriod: async () => undefined,
      create: async (input) => {
        const record = { reportId: "report-chain4" as never, ...input, status: "FINALIZED" as const, generatedAt: "2026-02-02T09:00:01Z", createdAt: "2026-02-02T09:00:01Z", supersedesReportId: input.supersedesReportId, supersededReason: input.supersededReason };
        reportsStore.set(input.idempotencyKey, record);
        return record;
      },
    };

    const worker = new OperationalJobWorker({ jobs, handlers: [new WeeklyReportGenerationJobHandler({ ledger, reports })], audit });
    const outcome = await worker.runOnce(queued!.jobType);
    expect(outcome).toBe("claimed");

    const finished = (await jobs.listRecent()).find((j) => j.jobType === "WEEKLY_REPORT_GENERATION");
    expect(finished?.status).toBe("SUCCEEDED");
    expect(reportsStore.size).toBe(1);
  });
});
