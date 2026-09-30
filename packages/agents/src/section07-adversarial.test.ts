import { AgentOrchestrator, buildAgentExecutionContext, InMemoryIdempotencyStore, InMemoryInvocationsRepository, MessageKind, SideEffectLevel, CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, type AgentMessage } from "@sport-os/agent-core";
import { buildDefaultDoubleBetLegs, settleDoubleBetLeg } from "@sport-os/aviator-engine";
import {
  applyRiskRejection,
  computeCombinedProbability,
  createTicketDraft,
  DecisionOutcome,
  DecisionReasonCode,
  evaluateValue,
  ticketLegFromValueAssessment,
  transitionTicketStatus,
  TicketStatus,
  TicketValidationFailureCode,
  validateTicket,
  type DecisionPolicy,
  type PredictionSnapshot,
  type TicketLeg,
  type ValueEngineDependencies,
} from "@sport-os/football-engine";
import { MarketStatus, MarketType, type MarketObservation } from "@sport-os/market-engine";
import { buildStandardGateChecks, createEntitlementGateCheck, createRiskGateCheck, Entitlement, GlobalExecutionGate, InMemoryUsersRepository, LicenseStatus, Role, type License, type LicenseService } from "@sport-os/platform";
import { evaluateAviatorDailyRisk, evaluateTicketRisk, GlobalDailyRiskController, RiskCode, type TicketRiskInput, type TicketRiskLimits } from "@sport-os/risk-engine";
import type { Ticket } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { FOOTBALL_AUTOMATION_AGENT_DECLARATION, FootballAutomationAgent, FootballAutomationOutcome, FootballExecutionMode } from "./football/automation-agent.js";
import { ExecutionResultStatus, NotImplementedExecutionIntegration } from "./execution-integration.js";

/**
 * Section 07 §40 adversarial tests — all 14 numbered scenarios, explicit
 * and traceable back to the spec. Every scenario is exercised against the
 * REAL implementation (Value Engine, Ticket Engine, Risk Engine,
 * GlobalExecutionGate's concrete GateChecks, AgentOrchestrator), never a
 * hand-rolled stand-in for the thing under test — mirroring
 * `adversarial.test.ts`'s own Section 06 convention.
 */

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-01-10T18:00:00Z";

function policy(overrides: Partial<DecisionPolicy> = {}): DecisionPolicy {
  return { minimumEdge: 0.02, minimumExpectedValue: 0, minimumDataQuality: ["AVAILABLE"], minimumModelAgreementRatio: undefined, oddsValidity: { maxOddsAgeSeconds: 120 }, policyVersion: "policy-adversarial-v1", ...overrides };
}

function snapshot(overrides: Partial<PredictionSnapshot> = {}): PredictionSnapshot {
  return { fixtureId: FIXTURE_ID, snapshotTime: NOW, modelVersion: "model-adversarial-v1", dataQuality: "AVAILABLE", probabilityInputs: { probability1x2: { home: 0.6, draw: 0.25, away: 0.15 } }, ...overrides };
}

function observation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return { marketId: "obs-1", marketType: MarketType.MATCH_RESULT_1X2, fixtureId: FIXTURE_ID, selection: "HOME", line: undefined, odds: 2.0, oddsTimestamp: "2026-01-10T17:59:00Z", source: "test-bookmaker", sourceObservationId: undefined, status: MarketStatus.OPEN, schemaVersion: 1, ...overrides };
}

function deps(snap: PredictionSnapshot | undefined, obs: MarketObservation | undefined): ValueEngineDependencies {
  return { getPredictionSnapshot: async () => snap, getMarketObservation: async () => obs };
}

function riskLimits(overrides: Partial<TicketRiskLimits> = {}): TicketRiskLimits {
  return { maxStake: 100, maxDailyExposure: 500, maxTicketsPerDay: 10, maxAccumulatorLegs: 5, minimumDataQuality: ["AVAILABLE"], minimumModelAgreementRatio: undefined, restrictedCompetitionIds: [], restrictedMarketTypes: [], policyVersion: "risk-policy-adversarial-v1", ...overrides };
}

function ticketFixture(): Ticket {
  return { ticketId: "t1", selections: [], publishedAt: NOW };
}

function riskInput(overrides: Partial<TicketRiskInput> = {}): TicketRiskInput {
  return {
    ticketId: "33333333-3333-3333-3333-333333333333",
    legs: [{ fixtureId: FIXTURE_ID, competitionId: undefined, marketType: "match_result_1x2", correlationGroup: undefined }],
    proposedStake: 10,
    dailyStakeSoFar: 0,
    dailyTicketCountSoFar: 0,
    worstDataQuality: "AVAILABLE",
    modelAgreementRatio: undefined,
    ...overrides,
  };
}

function licenseServiceStub(license: License | undefined): LicenseService {
  return {
    getLicense: async () => license,
    hasEntitlement: async (_userId, entitlement) => (license ? license.status === LicenseStatus.ACTIVE && license.entitlements.includes(entitlement) : false),
    getLicenseForUser: async () => license,
    getEntitlements: async () => license?.entitlements ?? [],
    getLimits: async () => undefined,
    isLicenseActive: (candidate) => candidate.status === LicenseStatus.ACTIVE || candidate.status === LicenseStatus.TRIAL,
    checkLimit: () => true,
  };
}

function buildLicense(overrides: Partial<License> = {}): License {
  return { userId: "user-1", status: LicenseStatus.ACTIVE, role: Role.USER, entitlements: [], issuedAt: NOW, expiresAt: null, ...overrides };
}

function newHarness(executionAuthorizer?: GlobalExecutionGate) {
  return new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer });
}

function ctx(overrides: { invocationId?: string; correlationId?: string } = {}) {
  return buildAgentExecutionContext({ invocationId: overrides.invocationId ?? "44444444-4444-4444-4444-444444444444", correlationId: overrides.correlationId ?? "55555555-5555-5555-5555-555555555555", actorUserId: FIXTURE_ID, actorRole: "user", environment: "development", requestedOperation: "test" });
}

function commandFor<T>(targetAgent: string, payload: T, idempotencyKey?: string): AgentMessage<T> {
  return { messageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", correlationId: "55555555-5555-5555-5555-555555555555", kind: MessageKind.COMMAND, messageType: CommandType.REQUEST_EXECUTION, schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, sourceAgent: "system", targetAgent: targetAgent as never, payload, createdAt: NOW, idempotencyKey };
}

async function legFor(assessment: Parameters<typeof evaluateValue>[1], overrides?: Partial<MarketObservation>): Promise<TicketLeg> {
  const result = await evaluateValue(deps(snapshot(), observation(overrides)), assessment, policy());
  return ticketLegFromValueAssessment(result);
}

describe("§40 Section 07 adversarial tests", () => {
  it("1. Positive EV but risk rejection -> rejected (value and risk stay independently correct, only the final decision flips)", async () => {
    const bet = await evaluateValue(deps(snapshot(), observation({ odds: 3.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(bet.decision).toBe(DecisionOutcome.BET);
    expect(bet.expectedValue).toBeGreaterThan(0);

    const risk = evaluateTicketRisk(riskInput({ proposedStake: 200 }), riskLimits({ maxStake: 100 }), NOW);
    expect(risk.approved).toBe(false);

    const finalDecision = applyRiskRejection(bet, risk.approved, risk.riskCode as DecisionReasonCode);
    expect(finalDecision.decision).toBe(DecisionOutcome.RISK_REJECTED);
    expect(finalDecision.reasons).toContain(risk.riskCode);
    // The underlying value figures are byte-identical — risk never rewrites value.
    expect(finalDecision.expectedValue).toBe(bet.expectedValue);
    expect(finalDecision.edge).toBe(bet.edge);
  });

  it("2. Positive EV but stale odds -> rejected (never computes value from stale data, whatever the probability looks like)", async () => {
    const staleObservation = observation({ oddsTimestamp: "2026-01-10T17:00:00Z" }); // 60 minutes stale, threshold is 120s
    const result = await evaluateValue(deps(snapshot(), staleObservation), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    expect(result.decision).toBe(DecisionOutcome.WAIT);
    expect(result.reasons).toContain(DecisionReasonCode.ODDS_STALE);
    expect(result.expectedValue).toBeNull();
    expect(result.edge).toBeNull();
  });

  it("3. Valid decision but no execution entitlement -> rejected by the REAL createEntitlementGateCheck, before any execution adapter is reached", async () => {
    const license = buildLicense({ entitlements: [] }); // no FOOTBALL_AUTOMATION entitlement
    const check = createEntitlementGateCheck(licenseServiceStub(license), () => Entitlement.FOOTBALL_AUTOMATION);
    const result = await check.check({ userId: "user-1", agentType: "football_automation", action: "execute_ticket" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("ENTITLEMENT_MISSING");

    // End-to-end: the same denial through the full standard pipeline.
    const users = new InMemoryUsersRepository();
    const user = await users.upsertFromTelegram({ telegramUserId: 1, username: "a", firstName: "A", lastName: undefined, languageCode: undefined, isPremium: false, authenticatedAt: NOW });
    const gate = new GlobalExecutionGate(buildStandardGateChecks({ users, licenseService: licenseServiceStub(license), resolveRequiredEntitlement: () => Entitlement.FOOTBALL_AUTOMATION, integration: { isAvailable: async () => true } }));
    const authorization = await gate.authorize({ userId: user.id, agentType: "football_automation", action: "execute_ticket", metadata: { risk: { riskApproved: true } } });
    expect(authorization.authorized).toBe(false);
    if (!authorization.authorized) expect(authorization.failedCheck).toBe("entitlement");
  });

  it("4. Agent attempts direct execution adapter call -> impossible: the orchestrator's real GlobalExecutionGate blocks dispatch entirely, so the automation agent's execute() (and therefore any integration call) never runs", async () => {
    // createRiskGateCheck() denies by construction whenever no risk evaluation was supplied — proving an agent cannot skip straight to execution even with an otherwise-passing identity/license/entitlement chain.
    const gate = new GlobalExecutionGate([{ name: "identity", check: () => ({ allowed: true }) }, { name: "license", check: () => ({ allowed: true }) }, { name: "entitlement", check: () => ({ allowed: true }) }, createRiskGateCheck()]);
    const orchestrator = newHarness(gate);
    let integrationCalls = 0;
    const agent = new FootballAutomationAgent({ integration: { isAvailable: async () => { integrationCalls += 1; return true; }, validate: async () => ({ valid: true }), execute: async () => { integrationCalls += 1; throw new Error("must never be reached"); }, status: async () => ExecutionResultStatus.UNKNOWN } });
    agent.markReady();
    const result = await orchestrator.dispatch({
      message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticketFixture(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k-direct-1", userConfirmed: true }),
      agent,
      declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION,
      context: ctx(),
      sideEffectLevel: SideEffectLevel.EXECUTION,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe("RISK_REJECTED");
    expect(integrationCalls).toBe(0);
  });

  it("5. Duplicate execution request -> idempotent (the automation agent, and therefore the integration, runs exactly once for a repeated idempotency key)", async () => {
    const orchestrator = newHarness(new GlobalExecutionGate([]));
    let executions = 0;
    const agent = new FootballAutomationAgent({ integration: { isAvailable: async () => true, validate: async () => ({ valid: true }), execute: async (req) => { executions += 1; return { externalReference: "ext-1", stake: req.stake, executedAt: NOW, status: ExecutionResultStatus.EXECUTED }; }, status: async () => ExecutionResultStatus.EXECUTED } });
    agent.markReady();
    const key = "section07-exec-idempotency-1";
    const payload = { ticket: ticketFixture(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: key, userConfirmed: true };
    const first = await orchestrator.dispatch({ message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, payload, key), agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.EXECUTION });
    const second = await orchestrator.dispatch({ message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, payload, key), agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context: ctx({ invocationId: "66666666-6666-6666-6666-666666666666" }), sideEffectLevel: SideEffectLevel.EXECUTION });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.replayed).toBe(true);
    expect(executions).toBe(1);
    // The database-level twin of this guarantee (a real UNIQUE constraint on execution_requests.idempotency_key, rejecting a retry even across a different ticket_or_signal_id) is proven against real Postgres in tests/database/100_section07_rls_cases.sql TESTs 16-17.
  });

  it("6. User views an ASSISTED proposal but does not confirm -> no execution at all", async () => {
    let integrationCalls = 0;
    const agent = new FootballAutomationAgent({ integration: { isAvailable: async () => { integrationCalls += 1; return true; }, validate: async () => ({ valid: true }), execute: async () => { integrationCalls += 1; throw new Error("must never be reached"); }, status: async () => ExecutionResultStatus.UNKNOWN } });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { ticket: ticketFixture(), executionMode: FootballExecutionMode.ASSISTED, stake: 10, idempotencyKey: "k-noconfirm-1", userConfirmed: false }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.CONFIRMATION_REQUIRED);
    expect(integrationCalls).toBe(0);
  });

  it("7. User confirms but the REAL GlobalExecutionGate rejects -> no execution, whatever userConfirmed says", async () => {
    let integrationCalls = 0;
    const denyingLicenseCheck = { name: "license", check: () => ({ allowed: false, reason: "License expired.", code: "LICENSE_INACTIVE" }) };
    const gate = new GlobalExecutionGate([{ name: "identity", check: () => ({ allowed: true }) }, denyingLicenseCheck]);
    const orchestrator = newHarness(gate);
    const agent = new FootballAutomationAgent({ integration: { isAvailable: async () => { integrationCalls += 1; return true; }, validate: async () => ({ valid: true }), execute: async () => { integrationCalls += 1; throw new Error("must never be reached"); }, status: async () => ExecutionResultStatus.UNKNOWN } });
    agent.markReady();
    const result = await orchestrator.dispatch({
      message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticketFixture(), executionMode: FootballExecutionMode.ASSISTED, stake: 10, idempotencyKey: "k-gate-deny-1", userConfirmed: true }),
      agent,
      declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION,
      context: ctx(),
      sideEffectLevel: SideEffectLevel.EXECUTION,
    });
    expect(result.ok).toBe(false);
    expect(integrationCalls).toBe(0);
  });

  it("8. Bookmaker integration unavailable -> explicit NOT_AVAILABLE, both from the adapter's own validate() and from the automation agent's outcome — never a fabricated execution", async () => {
    const integration = new NotImplementedExecutionIntegration();
    expect(await integration.isAvailable()).toBe(false);
    const validation = await integration.validate({ ticketOrSignalId: "t1", stake: 10, idempotencyKey: "k1" });
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.status).toBe(ExecutionResultStatus.NOT_AVAILABLE);

    const agent = new FootballAutomationAgent({ integration });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { ticket: ticketFixture(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.NOT_AVAILABLE);
  });

  it("9. Ticket contains an invalid probability -> rejected by validateTicket() (a corrupted leg is caught, not silently accepted into an executable ticket)", async () => {
    const goodLeg = await legFor({ eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW });
    const corruptedLeg: TicketLeg = { ...goodLeg, legId: "corrupted-leg-1", probability: 1.5 }; // out of [0,1] — could never come from a real evaluateValue() call
    const ticket = createTicketDraft({ legs: [corruptedLeg], createdBy: "user-1" });
    const decision = await evaluateValue(deps(snapshot(), observation({ odds: 2.0 })), { eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, policy());
    const result = validateTicket(ticket, { maxAccumulatorLegs: 5 }, [decision]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failures).toContain(TicketValidationFailureCode.INVALID_PROBABILITY);
  });

  it("10. Historical ticket odds/version overwritten -> impossible: transitionTicketStatus() never mutates the original record, only returns a new one", async () => {
    const leg = await legFor({ eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW });
    const original = createTicketDraft({ legs: [leg], createdBy: "user-1", now: () => NOW });
    const originalSnapshot = { ...original };
    const transitioned = transitionTicketStatus(original, TicketStatus.PROPOSED, "2026-01-10T18:05:00Z");
    // The original object's own fields are byte-identical to before the call — nothing mutated it in place.
    expect(original).toEqual(originalSnapshot);
    expect(original.version).toBe(1);
    expect(original.status).toBe(TicketStatus.DRAFT);
    // The new object is a genuinely different version, never the same reference.
    expect(transitioned).not.toBe(original);
    expect(transitioned.version).toBe(2);
    expect(transitioned.status).toBe(TicketStatus.PROPOSED);
    // The DB-level twin of this guarantee (ticket_status_history's append-only, never-UPDATEd (ticket_id, version) rows) is proven against real Postgres in tests/database/100_section07_rls_cases.sql TESTs 34-35.
  });

  it("11. Accumulator probability uses an unsupported independence assumption -> explicitly flagged and versioned, never presented as exact", async () => {
    const leg1 = await legFor({ eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW });
    const leg2 = await legFor({ eventId: FIXTURE_ID, marketType: MarketType.MATCH_RESULT_1X2, selection: "HOME", now: NOW }, { selection: "HOME" });
    const combined = computeCombinedProbability([leg1, { ...leg2, legId: "leg-2" }]);
    expect(combined).toBeDefined();
    expect(combined?.method).toBe("independence_assumption");
    expect(combined?.calculationVersion).toMatch(/independence-assumption/);
    expect(JSON.stringify(combined)).not.toMatch(/exact|guarantee/i);
  });

  it("12. Aviator daily target reached -> execution blocked by the REAL shared GlobalDailyRiskController, never a second/invented ledger", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(120);
    const result = evaluateAviatorDailyRisk(controller, NOW);
    expect(result.approved).toBe(false);
    expect(result.riskCode).toBe(RiskCode.DAILY_TARGET_REACHED);
  });

  it("13. Aviator daily stop-loss reached -> execution blocked by the REAL shared GlobalDailyRiskController", () => {
    const controller = new GlobalDailyRiskController({ dailyTarget: 100, dailyStopLoss: 50 });
    controller.recordResult(-60);
    const result = evaluateAviatorDailyRisk(controller, NOW);
    expect(result.approved).toBe(false);
    expect(result.riskCode).toBe(RiskCode.DAILY_STOP_LOSS_REACHED);
  });

  it("14. Double Bet leg 1 cannot corrupt leg 2 -> fully independent state, even after one leg settles", () => {
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    expect(target1.stake).toBe(50);
    expect(target2.stake).toBe(50);
    expect(target1).not.toBe(target2);

    // Settling target1 (a crash before its cash-out target) must not touch target2 at all — different object, none of its fields observed.
    const settledTarget1 = settleDoubleBetLeg(target1, null, "2026-01-10T18:10:00Z");
    expect(settledTarget1.return).toBe(0);
    expect(settledTarget1.pnl).toBe(-50);
    expect(target2.actualExitMultiplier).toBeUndefined();
    expect(target2.return).toBeUndefined();
    expect(target2.pnl).toBeUndefined();
    expect(target2.settledAt).toBeUndefined();
    expect(target2.stake).toBe(50); // untouched by leg 1's settlement
  });
});
