import { InMemoryInvocationsRepository } from "@sport-os/agent-core";
import { AuditOutcome, InMemoryAuditService, JobStatus, type OperationalJobCompletionInput, type OperationalJobRecord, type OperationalJobsRepository } from "@sport-os/platform";
import { describe, expect, it } from "vitest";
import type { PerformanceLedgerReader } from "../weekly-report-service.js";
import { OperationalHealthCheckJobHandler } from "./operational-health-check-job.js";

function job(): OperationalJobRecord {
  return { jobId: "j1" as never, jobType: "OPERATIONAL_HEALTH_CHECK" as never, status: JobStatus.RUNNING, payloadReference: {}, scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), completedAt: undefined, attempts: 1, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "k1", createdBy: "system", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

class HealthyJobsRepository implements OperationalJobsRepository {
  async create(): Promise<OperationalJobRecord> {
    throw new Error("unused");
  }
  async findByIdempotencyKey(): Promise<OperationalJobRecord | undefined> {
    return undefined;
  }
  async claimNext(): Promise<OperationalJobRecord | undefined> {
    return undefined;
  }
  async transitionTo(_jobId: string, _completion: OperationalJobCompletionInput): Promise<OperationalJobRecord> {
    throw new Error("unused");
  }
  async listRecent(): Promise<readonly OperationalJobRecord[]> {
    return [];
  }
}

class ThrowingJobsRepository extends HealthyJobsRepository {
  override async listRecent(): Promise<readonly OperationalJobRecord[]> {
    throw new Error("connection refused");
  }
}

const healthyLedger: PerformanceLedgerReader = { listForPeriod: async () => [] };

describe("OperationalHealthCheckJobHandler — Section 11 Part F/Q (closes the previously-unimplemented 4th job type)", () => {
  it("TEST 1: reports success and audits a full subsystem breakdown when every reachable probe succeeds", async () => {
    const audit = new InMemoryAuditService();
    const handler = new OperationalHealthCheckJobHandler({ operationalJobs: new HealthyJobsRepository(), agentInvocations: new InMemoryInvocationsRepository(), performanceLedger: healthyLedger, audit, telegramConfigured: true, footballDataProviderConfigured: false, oddsProviderConfigured: false, aviatorDataConfigured: false });
    const result = await handler.handle(job());
    expect(result.ok).toBe(true);
    const event = audit.getEvents()[0]!;
    expect(event.action).toBe("operational_health_check");
    expect(event.outcome).toBe(AuditOutcome.SUCCESS);
  });

  it("TEST 2: a real DB probe failure makes the job FAIL (retryable) and audits health_check_failure — never a fake HEALTHY", async () => {
    const audit = new InMemoryAuditService();
    const handler = new OperationalHealthCheckJobHandler({ operationalJobs: new ThrowingJobsRepository(), agentInvocations: new InMemoryInvocationsRepository(), performanceLedger: healthyLedger, audit, telegramConfigured: false, footballDataProviderConfigured: false, oddsProviderConfigured: false, aviatorDataConfigured: false });
    const result = await handler.handle(job());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe("INTEGRATION_UNAVAILABLE");
    const event = audit.getEvents()[0]!;
    expect(event.action).toBe("health_check_failure");
    expect(event.outcome).toBe(AuditOutcome.FAILURE);
  });

  it("TEST 3: an unconfigured integration is reported NOT_CONFIGURED, never HEALTHY", async () => {
    const audit = new InMemoryAuditService();
    const handler = new OperationalHealthCheckJobHandler({ operationalJobs: new HealthyJobsRepository(), agentInvocations: new InMemoryInvocationsRepository(), performanceLedger: healthyLedger, audit, telegramConfigured: false, footballDataProviderConfigured: false, oddsProviderConfigured: false, aviatorDataConfigured: false });
    await handler.handle(job());
    const subsystems = audit.getEvents()[0]!.metadata!.subsystems as Record<string, { status: string }>;
    expect(subsystems.telegram_integration!.status).toBe("NOT_CONFIGURED");
  });

  it("TEST 4: a configured-but-unprobed integration is reported UNKNOWN, never a fabricated HEALTHY", async () => {
    const audit = new InMemoryAuditService();
    const handler = new OperationalHealthCheckJobHandler({ operationalJobs: new HealthyJobsRepository(), agentInvocations: new InMemoryInvocationsRepository(), performanceLedger: healthyLedger, audit, telegramConfigured: true, footballDataProviderConfigured: false, oddsProviderConfigured: false, aviatorDataConfigured: false });
    await handler.handle(job());
    const subsystems = audit.getEvents()[0]!.metadata!.subsystems as Record<string, { status: string }>;
    expect(subsystems.telegram_integration!.status).toBe("UNKNOWN");
  });
});
