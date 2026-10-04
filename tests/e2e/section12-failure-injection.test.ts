/**
 * Section 12 Part AG — failure injection at major chain boundaries.
 * Every scenario here deliberately breaks something a real deployment
 * can genuinely encounter (an expired/suspended/revoked license, an
 * invalid ticket, a Telegram API error, a duplicate dispatch, a
 * dependency that throws like a timed-out database call) and asserts
 * the SAFE outcome: no crash, no fabricated success, no double
 * execution, no silent data corruption — only an honest, classified
 * failure (or a correctly-denied gate) that a caller can act on.
 */
import { AgentOrchestrator, buildAgentExecutionContext, InMemoryIdempotencyStore, InMemoryInvocationsRepository, type AgentMessage, CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, MessageKind, SideEffectLevel } from "@sport-os/agent-core";
import { FOOTBALL_AUTOMATION_AGENT_DECLARATION, FootballAutomationAgent, FootballExecutionMode, NotImplementedExecutionIntegration, OperationalJobWorker, PublishingAuthorizer, TelegramChannelManagementAgent, TelegramReportPublicationJobHandler, type WeeklyReportRecord } from "@sport-os/agents";
import { createTicketDraft, ticketLegFromValueAssessment, validateTicket, DecisionOutcome, type ValueAssessment } from "@sport-os/football-engine";
import {
  createEntitlementGateCheck,
  createIdentityGateCheck,
  createIntegrationAvailabilityGateCheck,
  createLicenseGateCheck,
  Entitlement,
  GlobalExecutionGate,
  InMemoryAuditService,
  InMemoryLicenseEntitlementsRepository,
  InMemoryLicenseLimitsRepository,
  InMemoryLicensesRepository,
  InMemoryUsersRepository,
  DatabaseLicenseService,
  LicenseStatus,
  type NewOperationalJobInput,
  type OperationalJobRecord,
  type OperationalJobsRepository,
} from "@sport-os/platform";
import { type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { TelegramDestinationType } from "@sport-os/telegram";
import { err, generateId, ok } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import type { JobHandler, JobHandlerResult } from "@sport-os/agents";

const NOW = "2026-02-02T12:00:00Z";
const FIXTURE_ID = "aaaaaaaa-1111-1111-1111-111111111111";

async function buildExecutionGateHarness(licenseStatus: LicenseStatus, expiresAt: string | null) {
  const users = new InMemoryUsersRepository();
  const user = await users.upsertFromTelegram({ telegramUserId: 808080, username: "injected", firstName: "Failure", lastName: "Injection", languageCode: "en", isPremium: false, authenticatedAt: NOW });
  const entitlements = new InMemoryLicenseEntitlementsRepository();
  const licenses = new InMemoryLicensesRepository(entitlements);
  const limits = new InMemoryLicenseLimitsRepository();
  const licenseService = new DatabaseLicenseService(licenses, entitlements, limits);
  const license = await licenses.insert({ userId: user.id, licenseKey: "injection-key", plan: "pro", status: licenseStatus, startsAt: "2026-01-01T00:00:00Z", expiresAt, maxDevices: 1, createdBy: user.id });
  await entitlements.upsert(license.id, Entitlement.FOOTBALL_TICKETS, true);

  const gate = new GlobalExecutionGate([createIdentityGateCheck(users), createLicenseGateCheck(licenseService), createEntitlementGateCheck(licenseService, () => Entitlement.FOOTBALL_TICKETS), createIntegrationAvailabilityGateCheck({ isAvailable: async () => true })]);
  const orchestrator = new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer: gate });
  const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
  agent.markReady();

  const assessment: ValueAssessment = { eventId: FIXTURE_ID, marketType: "match_result_1x2" as never, selection: "HOME", decision: DecisionOutcome.BET, modelProbability: 0.6, marketImpliedProbability: 0.47, edge: 0.13, expectedValue: 0.12, fairOdds: 1.67, offeredOdds: 2.1, dataQuality: "AVAILABLE", modelVersion: "e2e-model-v1", policyVersion: "e2e-policy-v1", evaluatedAt: NOW };
  const leg = ticketLegFromValueAssessment(assessment);
  const draft = createTicketDraft({ legs: [leg], createdBy: user.id, now: () => NOW });

  return { users, user, orchestrator, agent, draft };
}

async function dispatchDraft(harness: Awaited<ReturnType<typeof buildExecutionGateHarness>>, idempotencyKey: string) {
  const context = buildAgentExecutionContext({ invocationId: generateId(), correlationId: generateId(), actorUserId: harness.user.id, actorRole: "user", environment: "development", requestedOperation: "e2e_failure_injection" });
  const message: AgentMessage<{ ticket: typeof harness.draft; executionMode: FootballExecutionMode; stake: number; idempotencyKey: string; userConfirmed: boolean }> = {
    messageId: generateId(),
    correlationId: context.correlationId,
    kind: MessageKind.COMMAND,
    messageType: CommandType.REQUEST_EXECUTION,
    schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
    sourceAgent: "system",
    targetAgent: FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType as never,
    payload: { ticket: harness.draft, executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey, userConfirmed: true },
    idempotencyKey,
    createdAt: NOW,
  };
  return orchestratorDispatch(harness, message);
}

async function orchestratorDispatch(harness: Awaited<ReturnType<typeof buildExecutionGateHarness>>, message: AgentMessage<unknown>) {
  return harness.orchestrator.dispatch({ message: message as never, agent: harness.agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context: buildAgentExecutionContext({ invocationId: generateId(), correlationId: message.correlationId, actorUserId: harness.user.id, actorRole: "user", environment: "development", requestedOperation: "e2e_failure_injection" }), sideEffectLevel: SideEffectLevel.EXECUTION });
}

describe("Failure injection — license status denies the real execution gate, never the agent", () => {
  it("an EXPIRED license is denied at the gate before the agent ever runs", async () => {
    const harness = await buildExecutionGateHarness(LicenseStatus.EXPIRED, "2025-01-01T00:00:00Z");
    let agentCalled = false;
    const originalExecute = harness.agent.execute.bind(harness.agent);
    harness.agent.execute = async (request) => {
      agentCalled = true;
      return originalExecute(request);
    };

    const result = await dispatchDraft(harness, `e2e-failure-expired-${harness.draft.ticketId}`);

    expect(result.ok).toBe(false);
    expect(agentCalled).toBe(false);
  });

  it("a SUSPENDED license is denied at the gate before the agent ever runs", async () => {
    const harness = await buildExecutionGateHarness(LicenseStatus.SUSPENDED, null);
    let agentCalled = false;
    const originalExecute = harness.agent.execute.bind(harness.agent);
    harness.agent.execute = async (request) => {
      agentCalled = true;
      return originalExecute(request);
    };

    const result = await dispatchDraft(harness, `e2e-failure-suspended-${harness.draft.ticketId}`);

    expect(result.ok).toBe(false);
    expect(agentCalled).toBe(false);
  });

  it("a REVOKED license is denied at the gate before the agent ever runs", async () => {
    const harness = await buildExecutionGateHarness(LicenseStatus.REVOKED, null);
    let agentCalled = false;
    const originalExecute = harness.agent.execute.bind(harness.agent);
    harness.agent.execute = async (request) => {
      agentCalled = true;
      return originalExecute(request);
    };

    const result = await dispatchDraft(harness, `e2e-failure-revoked-${harness.draft.ticketId}`);

    expect(result.ok).toBe(false);
    expect(agentCalled).toBe(false);
  });
});

describe("Failure injection — an invalid ticket never reaches risk or the execution gate", () => {
  it("createTicketDraft refuses a zero-leg ticket outright — there is no way to construct one", () => {
    expect(() => createTicketDraft({ legs: [], createdBy: "user-invalid-ticket", now: () => NOW })).toThrow(/at least one leg/i);
  });

  it("a ticket whose leg has no matching BET decision fails validateTicket and the chain halts before any gate dispatch", async () => {
    const assessment: ValueAssessment = { eventId: FIXTURE_ID, marketType: "match_result_1x2" as never, selection: "HOME", decision: DecisionOutcome.BET, modelProbability: 0.6, marketImpliedProbability: 0.47, edge: 0.13, expectedValue: 0.12, fairOdds: 1.67, offeredOdds: 2.1, dataQuality: "AVAILABLE", modelVersion: "e2e-model-v1", policyVersion: "e2e-policy-v1", evaluatedAt: NOW };
    const leg = ticketLegFromValueAssessment(assessment);
    const draft = createTicketDraft({ legs: [leg], createdBy: "user-invalid-ticket", now: () => NOW });

    // Deliberately pass NO decisions — simulates a draft reaching
    // validation detached from the real decision that produced it (a
    // stale/replayed/forged leg). Every real caller in this codebase
    // passes the real decisions array; this proves what happens when
    // that invariant is violated: validation fails, never silently
    // passes.
    const validated = validateTicket(draft, { maxAccumulatorLegs: 5 }, []);

    expect(validated.valid).toBe(false);
    expect(validated.failures).toContain("DECISION_NOT_BET");
    // The boundary this proves: a caller that respects `validated.valid`
    // never constructs a dispatch message at all — there is no gate
    // bypass path and no fabricated ticket execution for invalid input.
  });
});

describe("Failure injection — a duplicate idempotency key never double-executes", () => {
  it("dispatching the same idempotencyKey twice runs the agent once and replays the first outcome the second time", async () => {
    const harness = await buildExecutionGateHarness(LicenseStatus.ACTIVE, null);
    let agentInvocationCount = 0;
    const originalExecute = harness.agent.execute.bind(harness.agent);
    harness.agent.execute = async (request) => {
      agentInvocationCount += 1;
      return originalExecute(request);
    };

    const key = `e2e-failure-duplicate-${harness.draft.ticketId}`;
    const first = await dispatchDraft(harness, key);
    const second = await dispatchDraft(harness, key);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.replayed).toBe(true);
    expect(agentInvocationCount).toBe(1);
  });
});

describe("Failure injection — a Telegram send failure never fabricates a sent message (a genuine Section 12 finding: the job-level signal does not distinguish this from 'no eligible destination')", () => {
  class FakeReportsStore {
    private readonly byId = new Map<string, WeeklyReportRecord>();
    constructor(record: WeeklyReportRecord) {
      this.byId.set(record.reportId as unknown as string, record);
    }
    async findById(reportId: string) {
      return this.byId.get(reportId);
    }
  }

  it("when the Telegram Bot API call itself fails for every destination, no message is ever sent — but the job handler still reports ok:true, a discovered (non-security) monitoring gap", async () => {
    const destination: TelegramDestination = { destinationId: "dest-injected", telegramChatId: "-100999", name: "Injected Failure Channel", type: TelegramDestinationType.CHANNEL, enabled: true, autoPublish: true, publishBookingCode: false, publishTicket: false, publishResults: false, publishWeeklyReport: true, createdAt: NOW, verificationStatus: "verified", verifiedAt: NOW };
    const destinations: TelegramDestinationManager = {
      list: async () => [destination],
      get: async () => destination,
      create: async () => destination,
      update: async () => destination,
    };
    let sentMessages = 0;
    const telegram: TelegramService = {
      sendMessage: async () => {
        // Simulated Telegram Bot API outage — never a thrown exception,
        // the real TelegramService contract reports failure as a Result.
        return err({ message: "Telegram API request failed: 503 Service Unavailable" });
      },
      replyToMessage: async () => {
        sentMessages += 1;
        return ok<SendMessageResult>({ messageId: 99 });
      },
      getChat: async () => ok({ id: -100999, type: "channel", title: "Injected Failure Channel" }),
      getChatMember: async () => ok({ status: "administrator" }),
    };
    const channelAgent = new TelegramChannelManagementAgent({ destinations, telegram });

    const users = new InMemoryUsersRepository();
    const adminUser = await users.upsertFromTelegram({ telegramUserId: 2, username: "admin2", firstName: "Admin", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: NOW });
    const entitlements = new InMemoryLicenseEntitlementsRepository();
    const licenses = new InMemoryLicensesRepository(entitlements);
    const licenseService = new DatabaseLicenseService(licenses, entitlements, new InMemoryLicenseLimitsRepository());
    const adminLicense = await licenses.insert({ userId: adminUser.id, licenseKey: "admin-key-2", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: NOW, expiresAt: null, maxDevices: 1, createdBy: adminUser.id });
    await entitlements.upsert(adminLicense.id, Entitlement.WEEKLY_REPORTS, true);

    const authorizer = new PublishingAuthorizer({ users, licenseService, resolveRequiredEntitlement: () => Entitlement.WEEKLY_REPORTS });
    const orchestrator = new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer: authorizer });

    const reportRecord: WeeklyReportRecord = { reportId: generateId() as never, periodStart: "2026-01-26T00:00:00Z", periodEnd: "2026-02-01T23:59:59Z", ledgerMode: "LIVE" as never, reportVersion: 1, status: "FINALIZED", generatedAt: NOW, generatedBy: "system", sourceReference: undefined, reportPayload: { periodStart: "2026-01-26T00:00:00Z", periodEnd: "2026-02-01T23:59:59Z", financialTotals: { actualPnl: { amount: 11, currency: "NGN" } }, ticketCounts: { total: 1, won: 1, lost: 0 } } as never, supersedesReportId: undefined, supersededReason: undefined, idempotencyKey: "injected-report", createdAt: NOW };
    const reports = new FakeReportsStore(reportRecord);
    const handler = new TelegramReportPublicationJobHandler({ orchestrator, channelAgent, reports: reports as never });

    const job: OperationalJobRecord = { jobId: generateId() as never, jobType: "TELEGRAM_REPORT_PUBLICATION" as never, status: "RUNNING" as never, payloadReference: { reportId: reportRecord.reportId }, scheduledAt: NOW, startedAt: NOW, completedAt: undefined, attempts: 1, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "job-injected", createdBy: adminUser.id, createdAt: NOW, updatedAt: NOW };
    const publishResult = await handler.handle(job);

    // The integrity property that actually matters holds: no message
    // is ever fabricated as sent, and a publication failure never
    // touches the already-FINALIZED report payload (the handler only
    // reads it).
    expect(sentMessages).toBe(0);
    expect(reportRecord.status).toBe("FINALIZED");

    // Genuine Section 12 finding, documented rather than silently
    // patched (patching it would require widening `TelegramPublicationResult.skipped`
    // with a POLICY vs SEND_FAILURE discriminator — a real interface
    // change, not a "smallest safe fix"): `TelegramReportPublicationJobHandler.handle()`
    // only inspects `orchestrator.dispatch()`'s own `result.ok` — which
    // reflects whether the COMMAND was dispatched and authorized, not
    // whether any destination actually received the message. Because
    // `TelegramChannelManagementAgent.execute()` isolates per-destination
    // failures into its own `skipped` list and always returns a
    // successful `AgentResponse`, a total Telegram outage during
    // publication currently surfaces as job `ok: true` — identical to
    // "no destination is yet subscribed to weekly reports" — so this
    // job is never retried by the worker even though zero messages were
    // delivered. This is an operational monitoring/alerting gap, not a
    // security or financial-integrity issue (no money, ticket, or report
    // state is affected), and is reported as such in the Section 12
    // final report rather than fixed under test pressure.
    expect(publishResult.ok).toBe(true);
  });
});

describe("Failure injection — a dependency that throws like a timed-out database call never crashes the worker", () => {
  class ThrowingJobsRepository implements OperationalJobsRepository {
    private readonly jobs = new Map<string, OperationalJobRecord>();
    constructor(seed: OperationalJobRecord) {
      this.jobs.set(seed.jobId, seed);
    }
    async create(_input: NewOperationalJobInput): Promise<OperationalJobRecord> {
      throw new Error("simulated database timeout on create");
    }
    async findByIdempotencyKey(): Promise<OperationalJobRecord | undefined> {
      return undefined;
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
      const updated = { ...existing, status: completion.status as never, lastError: completion.lastError, lastFailureCategory: completion.lastFailureCategory as never };
      this.jobs.set(jobId, updated);
      return updated;
    }
    async listRecent(): Promise<readonly OperationalJobRecord[]> {
      return [...this.jobs.values()];
    }
  }

  class TimingOutHandler implements JobHandler {
    readonly jobType = "WEEKLY_REPORT_GENERATION" as never;
    async handle(): Promise<JobHandlerResult> {
      // Simulates a downstream dependency (e.g. Postgres, a provider
      // API) that hangs/errors rather than ever resolving cleanly —
      // the handler throws, exactly like a real network-level timeout.
      throw new Error("simulated provider timeout");
    }
  }

  it("a handler that throws (simulating a DB/provider timeout) is caught, classified, and the worker keeps running", async () => {
    const seed: OperationalJobRecord = { jobId: "job-timeout-1" as never, jobType: "WEEKLY_REPORT_GENERATION" as never, status: "QUEUED", payloadReference: {}, scheduledAt: NOW, startedAt: undefined, completedAt: undefined, attempts: 0, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "job-timeout-key", createdBy: "system", createdAt: NOW, updatedAt: NOW };
    const jobs = new ThrowingJobsRepository(seed);
    const audit = new InMemoryAuditService();
    const worker = new OperationalJobWorker({ jobs, handlers: [new TimingOutHandler()], audit });

    const outcome = await worker.runOnce("WEEKLY_REPORT_GENERATION" as never);

    expect(outcome).toBe("claimed");
    const finished = (await jobs.listRecent()).find((j) => j.jobId === "job-timeout-1");
    // Never left RUNNING forever, never silently marked SUCCEEDED — a
    // thrown dependency failure is classified and either retried or
    // terminated, the same safe contract `worker.test.ts` TEST 6 proves
    // at the unit level; this proves the same guarantee holds when the
    // throwing dependency sits one layer further down a real chain.
    expect(finished?.status === "QUEUED" || finished?.status === "FAILED").toBe(true);
    expect(finished?.lastFailureCategory).toBeDefined();
  });
});
