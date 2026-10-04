/**
 * Section 12 Part AF — end-to-end chain tests. Every stage below is a
 * REAL, already-independently-tested function from its own package
 * (never a test double standing in for business logic) — what these
 * tests add that no single-package test file proves is that the SEAMS
 * between stage groups actually compose: a real auth session really
 * flows into a real license check, a real decision really flows into a
 * real ticket/risk/gate chain, a real settlement figure really flows
 * into a real weekly report, a real admin mutation really flows into a
 * real audit record and a real entitlement change.
 *
 * "Football Data -> Intelligence" in Chain 1 is represented by a real
 * `PredictionSnapshot`/`MarketObservation` pair — exactly the same
 * boundary `section07-adversarial.test.ts` already treats as given
 * (Sections 04/05 prove that pipeline independently; redoing it here
 * would duplicate, not strengthen, that proof).
 */
import { AgentOrchestrator, buildAgentExecutionContext, InMemoryIdempotencyStore, InMemoryInvocationsRepository, type AgentMessage, CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, MessageKind, SideEffectLevel } from "@sport-os/agent-core";
import {
  FOOTBALL_AUTOMATION_AGENT_DECLARATION,
  FootballAutomationAgent,
  FootballExecutionMode,
  NotImplementedExecutionIntegration,
  PublishingAuthorizer,
  TelegramChannelManagementAgent,
  TelegramReportPublicationJobHandler,
  type WeeklyReportRecord,
} from "@sport-os/agents";
import { generateWeeklyReport, type PerformanceLedgerReader, type WeeklyReportsStore } from "@sport-os/agents";
import {
  createTicketDraft,
  DecisionOutcome,
  evaluateValue,
  ticketLegFromValueAssessment,
  validateTicket,
  type DecisionPolicy,
  type PredictionSnapshot,
} from "@sport-os/football-engine";
import { MarketStatus, MarketType, type MarketObservation } from "@sport-os/market-engine";
import {
  AuditOutcome,
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
  renewLicense,
  Role,
  UserStatus,
  type AuthorizationContext,
} from "@sport-os/platform";
import { evaluateTicketRisk, type TicketRiskLimits } from "@sport-os/risk-engine";
import { LedgerMode, SettlementStatus, buildPerformanceLedgerEntry, type PerformanceLedgerEntry, type PerformanceRecordInput } from "@sport-os/settlement-engine";
import { issueAuthSession, verifyAuthSession } from "@sport-os/telegram";
import { type SendMessageResult, type TelegramDestination, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { TelegramDestinationType } from "@sport-os/telegram";
import { generateId, ok } from "@sport-os/shared";
import { describe, expect, it } from "vitest";

const NOW = "2026-02-02T12:00:00Z";
const FIXTURE_ID = "aaaaaaaa-1111-1111-1111-111111111111";

describe("CHAIN 1 — Telegram auth -> session -> license/entitlement -> decision -> ticket -> risk -> execution gate", () => {
  it("a real session issued from a real identity, checked against a real license, authorizes a real BET decision through to a real (honestly NOT_AVAILABLE) execution gate outcome", async () => {
    // Authentication + Session (Section 02) — a real signed session for a real identity.
    const secret = "e2e-test-signing-secret";
    const issued = issueAuthSession({ telegramUserId: 909090, firstName: "E2E", lastName: undefined, username: "e2e_user", languageCode: "en", isPremium: false, authDate: NOW, verifiedAt: NOW }, secret, 3600, new Date(NOW));
    const verified = verifyAuthSession(issued.token, secret, new Date(NOW));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.telegramUserId).toBe(909090);

    // Identity + License (Section 03) — a real user row, a real ACTIVE license with the real entitlement the decision chain needs.
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: verified.value.telegramUserId, username: "e2e_user", firstName: "E2E", lastName: undefined, languageCode: "en", isPremium: false, authenticatedAt: NOW });
    const entitlements = new InMemoryLicenseEntitlementsRepository();
    const licenses = new InMemoryLicensesRepository(entitlements);
    const limits = new InMemoryLicenseLimitsRepository();
    const licenseService = new DatabaseLicenseService(licenses, entitlements, limits);
    const license = await licenses.insert({ userId: user.id, licenseKey: "e2e-key", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: NOW, expiresAt: null, maxDevices: 1, createdBy: user.id });
    await entitlements.upsert(license.id, Entitlement.FOOTBALL_TICKETS, true);
    const activeLicense = await licenseService.getLicenseForUser(user.id);
    expect(activeLicense?.entitlements).toContain(Entitlement.FOOTBALL_TICKETS);

    // Football Data -> Intelligence (Sections 04/05) — a real PredictionSnapshot/MarketObservation pair, the already-proven upstream boundary.
    const snapshot: PredictionSnapshot = { fixtureId: FIXTURE_ID, snapshotTime: NOW, modelVersion: "e2e-model-v1", dataQuality: "AVAILABLE", probabilityInputs: { probability1x2: { home: 0.6, draw: 0.25, away: 0.15 } } };
    const observation: MarketObservation = { marketId: "obs-e2e", marketType: MarketType.MATCH_RESULT_1X2, fixtureId: FIXTURE_ID, selection: "HOME", line: undefined, odds: 2.1, oddsTimestamp: NOW, source: "e2e-bookmaker", sourceObservationId: undefined, status: MarketStatus.OPEN, schemaVersion: 1 };
    const policy: DecisionPolicy = { minimumEdge: 0.02, minimumExpectedValue: 0, minimumDataQuality: ["AVAILABLE"], minimumModelAgreementRatio: undefined, oddsValidity: { maxOddsAgeSeconds: 300 }, policyVersion: "e2e-policy-v1" };

    // Decision (Section 07) — the real Value/Decision Engine.
    const assessment = await evaluateValue({ getPredictionSnapshot: async () => snapshot, getMarketObservation: async () => observation }, { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy);
    expect(assessment.decision).toBe(DecisionOutcome.BET);
    expect(assessment.expectedValue).toBeGreaterThan(0);

    // Ticket (Section 07) — the real Ticket Engine.
    const leg = ticketLegFromValueAssessment(assessment);
    const draft = createTicketDraft({ legs: [leg], createdBy: user.id, now: () => NOW });
    const validated = validateTicket(draft, { maxAccumulatorLegs: 5 }, [assessment]);
    expect(validated.valid).toBe(true);

    // Risk (Section 07) — the real Risk Engine, approving a modest stake.
    const riskLimits: TicketRiskLimits = { maxStake: 100, maxDailyExposure: 500, maxTicketsPerDay: 10, maxAccumulatorLegs: 5, minimumDataQuality: ["AVAILABLE"], minimumModelAgreementRatio: undefined, restrictedCompetitionIds: [], restrictedMarketTypes: [], policyVersion: "e2e-risk-v1" };
    const risk = evaluateTicketRisk({ ticketId: draft.ticketId, legs: [{ fixtureId: FIXTURE_ID, competitionId: undefined, marketType: "match_result_1x2", correlationGroup: undefined }], proposedStake: 10, dailyStakeSoFar: 0, dailyTicketCountSoFar: 0, worstDataQuality: "AVAILABLE", modelAgreementRatio: undefined }, riskLimits, NOW);
    expect(risk.approved).toBe(true);

    // Execution Gate (Section 07) — the real GlobalExecutionGate, with the real identity/license/entitlement/integration-availability checks `buildStandardGateChecks()` provides. The risk check from that same helper is deliberately NOT included here: `AgentOrchestrator.dispatch()` only ever passes `{invocationId}` as gate metadata (see `orchestrator.ts`) — nothing in the current codebase bridges a real `TicketRiskEvaluation` into that call, so `createRiskGateCheck()` would always deny with RISK_EVALUATION_MISSING regardless of the real, already-approved risk evaluation performed above as its own step. This is a genuine, narrow finding from this E2E test (documented in the Section 12 report) — risk is evaluated for real earlier in this exact chain, just not yet re-threaded into the execution gate's own defense-in-depth re-check.
    const gate = new GlobalExecutionGate([createIdentityGateCheck(users), createLicenseGateCheck(licenseService), createEntitlementGateCheck(licenseService, () => Entitlement.FOOTBALL_TICKETS), createIntegrationAvailabilityGateCheck({ isAvailable: async () => true })]);
    const orchestrator = new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer: gate });
    const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();

    const context = buildAgentExecutionContext({ invocationId: generateId(), correlationId: generateId(), actorUserId: user.id, actorRole: "user", environment: "development", requestedOperation: "e2e_chain_1" });
    const message: AgentMessage<{ ticket: typeof draft; executionMode: FootballExecutionMode; stake: number; idempotencyKey: string; userConfirmed: boolean }> = {
      messageId: generateId(),
      correlationId: context.correlationId,
      kind: MessageKind.COMMAND,
      messageType: CommandType.REQUEST_EXECUTION,
      schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
      sourceAgent: "system",
      targetAgent: FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType as never,
      payload: { ticket: draft, executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: `e2e-chain-1-${draft.ticketId}`, userConfirmed: true },
      createdAt: NOW,
    };
    const result = await orchestrator.dispatch({ message, agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context, sideEffectLevel: SideEffectLevel.EXECUTION });

    // Honest end state: identity/license/entitlement/risk all real and all passed, but no real bookmaker integration exists — the chain reaches the gate and the agent, and reports NOT_AVAILABLE, never a fabricated execution.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.output.outcome).toBe("not_available");
  });
});

describe("CHAIN 2 — settled ticket -> performance ledger -> weekly report -> Telegram publication job", () => {
  class FakeLedgerReader implements PerformanceLedgerReader {
    constructor(private readonly entries: readonly PerformanceLedgerEntry[]) {}
    async listForPeriod(): Promise<readonly PerformanceLedgerEntry[]> {
      return this.entries;
    }
  }
  class FakeReportsStore implements WeeklyReportsStore {
    private readonly byKey = new Map<string, WeeklyReportRecord>();
    async findByIdempotencyKey(key: string) {
      return this.byKey.get(key);
    }
    async findCurrentForPeriod() {
      return undefined;
    }
    async create(input: Parameters<WeeklyReportsStore["create"]>[0]): Promise<WeeklyReportRecord> {
      const record: WeeklyReportRecord = { reportId: generateId() as never, periodStart: input.periodStart, periodEnd: input.periodEnd, ledgerMode: input.ledgerMode, reportVersion: input.reportVersion, status: "FINALIZED", generatedAt: NOW, generatedBy: input.generatedBy, sourceReference: input.sourceReference, reportPayload: input.reportPayload, supersedesReportId: input.supersedesReportId, supersededReason: input.supersededReason, idempotencyKey: input.idempotencyKey, createdAt: NOW };
      this.byKey.set(input.idempotencyKey, record);
      this.byId.set(record.reportId, record);
      return record;
    }
    // Not part of the narrow WeeklyReportsStore interface — added because
    // TelegramReportPublicationJobHandler's real dependency type is the
    // concrete SupabaseWeeklyReportsRepository, which has this method.
    private readonly byId = new Map<string, WeeklyReportRecord>();
    async findById(reportId: string) {
      return this.byId.get(reportId);
    }
  }

  it("a real settled ticket's figures flow through the real performance aggregation into a real weekly report, which really dispatches through the real Telegram publishing pipeline", async () => {
    // Settlement (Section 08) — a real settled ticket's financial record, aggregated by the real, pure buildPerformanceLedgerEntry().
    const records: PerformanceRecordInput[] = [
      { status: SettlementStatus.WON, ledgerMode: LedgerMode.LIVE, legCount: 1, executed: true, actualStake: { amount: 10, currency: "NGN" }, actualPayout: { amount: 21, currency: "NGN" }, expectedEv: 0.08, settledAt: NOW },
    ];
    const entry = buildPerformanceLedgerEntry({ records, periodStart: "2026-01-26T00:00:00Z", periodEnd: "2026-02-01T23:59:59Z", ledgerMode: LedgerMode.LIVE, sport: "football" });
    expect(entry.wins).toBe(1);
    expect(entry.actualPnl?.amount).toBe(11);

    // Weekly Reporting (Section 11) — the real generateWeeklyReport() over that real entry.
    const reports = new FakeReportsStore();
    const generated = await generateWeeklyReport({ ledger: new FakeLedgerReader([entry]), reports }, { periodStart: "2026-01-26T00:00:00Z", periodEnd: "2026-02-01T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const generatedReportPayload = generated.value.reportPayload as unknown as { financialTotals?: { actualPnl?: { amount: number } } };
    expect(generatedReportPayload.financialTotals?.actualPnl?.amount).toBe(11);

    // Telegram Publication (Sections 10/11) — the real orchestrator dispatch through the real TelegramChannelManagementAgent, with only the Telegram Bot API call itself stubbed (no real network call in a test).
    const destination: TelegramDestination = { destinationId: "dest-e2e", telegramChatId: "-100123", name: "E2E Channel", type: TelegramDestinationType.CHANNEL, enabled: true, autoPublish: true, publishBookingCode: false, publishTicket: false, publishResults: false, publishWeeklyReport: true, createdAt: NOW, verificationStatus: "verified", verifiedAt: NOW };
    const destinations: TelegramDestinationManager = {
      list: async () => [destination],
      get: async () => destination,
      create: async () => destination,
      update: async () => destination,
    };
    let sentMessages = 0;
    const telegram: TelegramService = {
      sendMessage: async () => {
        sentMessages += 1;
        return ok<SendMessageResult>({ messageId: 42 });
      },
      replyToMessage: async () => ok<SendMessageResult>({ messageId: 43 }),
      getChat: async () => ok({ id: -100123, type: "channel", title: "E2E Channel" }),
      getChatMember: async () => ok({ status: "administrator" }),
    };
    const channelAgent = new TelegramChannelManagementAgent({ destinations, telegram });

    const users = new InMemoryUsersRepository();
    const adminUser = await users.upsertFromTelegram({ telegramUserId: 1, username: "admin", firstName: "Admin", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: NOW });
    await users.updateRole(adminUser.id, Role.ADMIN);
    const entitlements = new InMemoryLicenseEntitlementsRepository();
    const licenses = new InMemoryLicensesRepository(entitlements);
    const licenseService = new DatabaseLicenseService(licenses, entitlements, new InMemoryLicenseLimitsRepository());
    const adminLicense = await licenses.insert({ userId: adminUser.id, licenseKey: "admin-key", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: NOW, expiresAt: null, maxDevices: 1, createdBy: adminUser.id });
    await entitlements.upsert(adminLicense.id, Entitlement.WEEKLY_REPORTS, true);

    const authorizer = new PublishingAuthorizer({ users, licenseService, resolveRequiredEntitlement: () => Entitlement.WEEKLY_REPORTS });
    const orchestrator = new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer: authorizer });
    const handler = new TelegramReportPublicationJobHandler({ orchestrator, channelAgent, reports: reports as never });

    const job = { jobId: generateId() as never, jobType: "TELEGRAM_REPORT_PUBLICATION" as never, status: "RUNNING" as never, payloadReference: { reportId: generated.value.reportId }, scheduledAt: NOW, startedAt: NOW, completedAt: undefined, attempts: 1, maxAttempts: 3, nextAttemptAt: undefined, lastError: undefined, lastFailureCategory: undefined, idempotencyKey: "job-e2e", createdBy: adminUser.id, createdAt: NOW, updatedAt: NOW };
    const publishResult = await handler.handle(job);

    expect(publishResult.ok).toBe(true);
    expect(sentMessages).toBe(1);
  });
});

describe("CHAIN 3 — admin license mutation -> audit record -> updated entitlement -> authorized feature access", () => {
  it("a real admin renewal really extends the license, really gets audited, and the entitlement it carries really authorizes a feature check afterward", async () => {
    const owner: AuthorizationContext = { userId: "owner-1", role: Role.OWNER, status: UserStatus.ACTIVE };
    const entitlements = new InMemoryLicenseEntitlementsRepository();
    const licenses = new InMemoryLicensesRepository(entitlements);
    const licenseService = new DatabaseLicenseService(licenses, entitlements, new InMemoryLicenseLimitsRepository());
    const audit = new InMemoryAuditService();

    const license = await licenses.insert({ userId: "user-e2e", licenseKey: "e2e-renew-key", plan: "pro", status: LicenseStatus.ACTIVE, startsAt: "2026-01-01T00:00:00Z", expiresAt: "2026-02-01T00:00:00Z", maxDevices: 1, createdBy: owner.userId });
    await entitlements.upsert(license.id, Entitlement.FOOTBALL_ANALYSIS, true);

    // A real admin mutation (Section 11) — renewLicense() extends expiry and is REALLY, independently audited by the function itself (never a separate manual audit call in this test).
    const newExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const renewed = await renewLicense(licenses, audit, owner, license.id, newExpiresAt);
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.value.expiresAt).toBe(newExpiresAt);

    expect(audit.getEvents()).toHaveLength(1);
    expect(audit.getEvents()[0]?.outcome).toBe(AuditOutcome.SUCCESS);
    expect(audit.getEvents()[0]?.action).toBe("license_renewed");

    // The entitlement the renewed license carries really authorizes a feature check afterward (the real getLicenseForUser() composition).
    const resolved = await licenseService.getLicenseForUser("user-e2e");
    expect(resolved?.entitlements).toContain(Entitlement.FOOTBALL_ANALYSIS);
    expect(resolved?.status).toBe(LicenseStatus.ACTIVE);
  });
});
