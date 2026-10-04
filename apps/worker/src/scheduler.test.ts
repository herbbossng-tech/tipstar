import type { NewOperationalJobInput, OperationalJobRecord, OperationalJobsRepository } from "@sport-os/platform";
import { describe, expect, it } from "vitest";
import { currentWeeklyReportPeriod, healthCheckBucketKey, runSchedulerTick, startOfIsoWeekUtc } from "./scheduler.js";

class FakeLogger {
  readonly infos: string[] = [];
  readonly warns: string[] = [];
  debug(): void {}
  info(message: string): void {
    this.infos.push(message);
  }
  warn(message: string): void {
    this.warns.push(message);
  }
  error(): void {}
  withRequestId() {
    return this as never;
  }
}

class FakeJobsRepository implements OperationalJobsRepository {
  readonly created: NewOperationalJobInput[] = [];
  private readonly byKey = new Map<string, OperationalJobRecord>();
  /** When true, `create()` throws on an idempotency key that isn't yet present, simulating a concurrent writer winning the race between this test's own `findByIdempotencyKey` check and its `create` call. */
  raceWinnerFor: string | undefined;

  async create(input: NewOperationalJobInput): Promise<OperationalJobRecord> {
    if (input.idempotencyKey === this.raceWinnerFor) {
      throw new Error("duplicate key value violates unique constraint");
    }
    this.created.push(input);
    const record: OperationalJobRecord = { jobId: `job-${this.created.length}` as never, jobType: input.jobType, status: "QUEUED", payloadReference: input.payloadReference, scheduledAt: input.scheduledAt, startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: input.maxAttempts, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: input.idempotencyKey, createdBy: input.createdBy, createdAt: input.scheduledAt, updatedAt: input.scheduledAt };
    this.byKey.set(input.idempotencyKey, record);
    return record;
  }
  async findByIdempotencyKey(idempotencyKey: string): Promise<OperationalJobRecord | undefined> {
    return this.byKey.get(idempotencyKey);
  }
  async claimNext(): Promise<OperationalJobRecord | undefined> {
    return undefined;
  }
  async transitionTo(): Promise<OperationalJobRecord> {
    throw new Error("unused");
  }
  async listRecent(): Promise<readonly OperationalJobRecord[]> {
    return [...this.byKey.values()];
  }
}

describe("startOfIsoWeekUtc / currentWeeklyReportPeriod — Section 12 Part K (explicit UTC timezone)", () => {
  it("resolves a Wednesday to the Monday of the same ISO week", () => {
    const wednesday = new Date("2026-01-14T15:30:00Z"); // a Wednesday
    expect(startOfIsoWeekUtc(wednesday).toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });

  it("resolves a Sunday to the Monday of the SAME week it ends, not the next one", () => {
    const sunday = new Date("2026-01-18T23:00:00Z");
    expect(startOfIsoWeekUtc(sunday).toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });

  it("the weekly report period is always the most recently COMPLETED week, never the week in progress", () => {
    const { periodStart, periodEnd } = currentWeeklyReportPeriod(new Date("2026-01-14T15:30:00Z"));
    expect(periodStart).toBe("2026-01-05T00:00:00.000Z");
    expect(periodEnd).toBe("2026-01-11T23:59:59.999Z");
  });

  it("every moment within the same ISO week produces the IDENTICAL period — the idempotency key never changes that week", () => {
    const monday = currentWeeklyReportPeriod(new Date("2026-01-12T00:00:01Z"));
    const sunday = currentWeeklyReportPeriod(new Date("2026-01-18T23:59:00Z"));
    expect(monday).toEqual(sunday);
  });
});

describe("healthCheckBucketKey — bounded execution identity for OPERATIONAL_HEALTH_CHECK", () => {
  it("two ticks in the same bucket produce the identical key", () => {
    const a = healthCheckBucketKey(new Date("2026-01-14T10:03:00Z"), 15);
    const b = healthCheckBucketKey(new Date("2026-01-14T10:14:59Z"), 15);
    expect(a).toBe(b);
  });

  it("ticks in different buckets produce different keys", () => {
    const a = healthCheckBucketKey(new Date("2026-01-14T10:03:00Z"), 15);
    const b = healthCheckBucketKey(new Date("2026-01-14T10:16:00Z"), 15);
    expect(a).not.toBe(b);
  });
});

describe("runSchedulerTick — Section 12 Part K (idempotent enqueue, tolerates duplicate ticks)", () => {
  it("TEST 1: a single tick enqueues exactly one WEEKLY_REPORT_GENERATION and one OPERATIONAL_HEALTH_CHECK job", async () => {
    const jobs = new FakeJobsRepository();
    await runSchedulerTick({ jobs, logger: new FakeLogger() as never }, new Date("2026-01-14T10:03:00Z"));
    expect(jobs.created.map((j) => j.jobType).sort()).toEqual(["OPERATIONAL_HEALTH_CHECK", "WEEKLY_REPORT_GENERATION"]);
  });

  it("TEST 2: ten ticks within the same hour create only ONE health-check job and ONE weekly-report job — duplicate ticks are fully tolerated", async () => {
    const jobs = new FakeJobsRepository();
    const logger = new FakeLogger();
    for (let i = 0; i < 10; i++) {
      await runSchedulerTick({ jobs, logger: logger as never }, new Date(`2026-01-14T10:0${i}:00Z`));
    }
    expect(jobs.created).toHaveLength(2);
  });

  it("TEST 3: ticking every day of the same ISO week creates only ONE weekly-report job for that week", async () => {
    const jobs = new FakeJobsRepository();
    const logger = new FakeLogger();
    for (const day of ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-18"]) {
      await runSchedulerTick({ jobs, logger: logger as never }, new Date(`${day}T09:00:00Z`));
    }
    const weeklyJobs = jobs.created.filter((j) => j.jobType === "WEEKLY_REPORT_GENERATION");
    expect(weeklyJobs).toHaveLength(1);
  });

  it("TEST 4: a race against a concurrent writer on the SAME idempotency key is tolerated, never thrown out of the tick", async () => {
    const jobs = new FakeJobsRepository();
    const now = new Date("2026-01-14T10:03:00Z");
    const { periodStart, periodEnd } = currentWeeklyReportPeriod(now);
    jobs.raceWinnerFor = `weekly-report:${periodStart}:${periodEnd}:LIVE`;
    const logger = new FakeLogger();
    await expect(runSchedulerTick({ jobs, logger: logger as never }, now)).resolves.toBeUndefined();
    expect(jobs.created.some((j) => j.jobType === "WEEKLY_REPORT_GENERATION")).toBe(false);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("TEST 5: every scheduler-created job uses the explicit SYSTEM actor, never a fabricated user id", async () => {
    const jobs = new FakeJobsRepository();
    await runSchedulerTick({ jobs, logger: new FakeLogger() as never }, new Date("2026-01-14T10:03:00Z"));
    expect(jobs.created.every((j) => j.createdBy === "system")).toBe(true);
  });
});
