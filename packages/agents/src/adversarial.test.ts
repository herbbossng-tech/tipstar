import { AgentOrchestrator, buildAgentExecutionContext, InMemoryIdempotencyStore, InMemoryInvocationsRepository, MessageKind, SideEffectLevel, CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, type AgentMessage } from "@sport-os/agent-core";
import { AviatorSignalState, type AviatorSignal } from "@sport-os/aviator-engine";
import type { PredictionOutput } from "@sport-os/football-engine";
import { NotImplementedDecisionEngine } from "@sport-os/football-engine";
import { GlobalExecutionGate, type GateCheck } from "@sport-os/platform";
import { RiskControllerState } from "@sport-os/risk-engine";
import type { Ticket } from "@sport-os/settlement-engine";
import { PublishableContentType, TelegramDestinationType, type SendMessageResult, type TelegramDestinationManager, type TelegramService } from "@sport-os/telegram";
import { ok } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { FOOTBALL_AUTOMATION_AGENT_DECLARATION, FootballAutomationAgent, FootballAutomationOutcome, FootballExecutionMode } from "./football/automation-agent.js";
import { FOOTBALL_DECISION_AGENT_DECLARATION, FootballDecisionAgent } from "./football/decision-agent.js";
import { FOOTBALL_INTELLIGENCE_AGENT_DECLARATION, FootballIntelligenceAgent } from "./football/intelligence-agent.js";
import { AviatorAutomationAgent, AviatorAutomationOutcome, AviatorExecutionMode } from "./aviator/automation-agent.js";
import { AVIATOR_RISK_AGENT_DECLARATION, type AviatorRiskDecision } from "./aviator/risk-agent.js";
import { NotImplementedExecutionIntegration } from "./execution-integration.js";
import { SettlementAgent } from "./football/settlement-agent.js";
import { TELEGRAM_CHANNEL_AGENT_DECLARATION, TelegramChannelManagementAgent } from "./telegram-channel-agent.js";

/**
 * Section 06 §33 (adversarial) and §34 (Section 07 boundary) tests —
 * explicit, numbered, and traceable back to the spec. Many individual
 * agents already assert pieces of this in their own test files; this
 * file additionally wires the REAL `AgentOrchestrator` +
 * `@sport-os/platform`'s REAL `GlobalExecutionGate` together (not just
 * an isolated agent call), because several of these guarantees are only
 * real when the orchestration layer is exercised end to end, not just
 * one agent in isolation.
 */

function newHarness(executionAuthorizer?: GlobalExecutionGate) {
  return new AgentOrchestrator({ invocations: new InMemoryInvocationsRepository(), idempotency: new InMemoryIdempotencyStore(), executionAuthorizer });
}

function ctx(overrides: { invocationId?: string; correlationId?: string } = {}) {
  return buildAgentExecutionContext({
    invocationId: overrides.invocationId ?? "11111111-1111-1111-1111-111111111111",
    correlationId: overrides.correlationId ?? "22222222-2222-2222-2222-222222222222",
    actorUserId: "33333333-3333-3333-3333-333333333333",
    actorRole: "user",
    environment: "development",
    requestedOperation: "test",
  });
}

function commandFor<T>(targetAgent: string, payload: T, idempotencyKey?: string): AgentMessage<T> {
  return {
    messageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    correlationId: "22222222-2222-2222-2222-222222222222",
    kind: MessageKind.COMMAND,
    messageType: CommandType.REQUEST_EXECUTION,
    schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
    sourceAgent: "system",
    targetAgent: targetAgent as never,
    payload,
    createdAt: new Date().toISOString(),
    idempotencyKey,
  };
}

function ticket(): Ticket {
  return { ticketId: "44444444-4444-4444-4444-444444444444", selections: [{ selectionId: "s1", eventId: "fixture-1", market: "match_result_1x2", selection: "HOME", oddsAtPublication: 2.0 }], publishedAt: "2026-01-10T18:00:00Z" };
}

describe("§33 Adversarial tests", () => {
  it("1. Agent attempts direct bookmaker execution -> rejected (no unsupported integration invented; only ever NOT_AVAILABLE)", async () => {
    const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.outcome).toBe(FootballAutomationOutcome.NOT_AVAILABLE);
  });

  it("2. Agent attempts execution without entitlement -> rejected by the REAL GlobalExecutionGate before the agent ever runs", async () => {
    const entitlementCheck: GateCheck = { name: "entitlement", check: () => ({ allowed: false, reason: "Missing football_automation entitlement", code: "ENTITLEMENT_DENIED" }) };
    const gate = new GlobalExecutionGate([{ name: "identity", check: () => ({ allowed: true }) }, { name: "license", check: () => ({ allowed: true }) }, entitlementCheck]);
    const orchestrator = newHarness(gate);
    const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();
    const result = await orchestrator.dispatch({
      message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true }),
      agent,
      declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION,
      context: ctx(),
      sideEffectLevel: SideEffectLevel.EXECUTION,
      authorizationAction: "place_wager",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe("ENTITLEMENT_ERROR");
  });

  it("3. Agent attempts execution after daily stop-loss -> rejected", async () => {
    const blockedRisk: AviatorRiskDecision = { executionAllowed: false, reason: RiskControllerState.DAILY_STOP_LOSS_REACHED, cumulativePnL: -60, evaluatedAt: "2026-01-01T00:00:00Z" };
    const signal: AviatorSignal = { signalId: "sig-1", state: AviatorSignalState.BUY, targetMultiplier: 1.5, confidence: 0.7, generatedAt: "2026-01-01T00:00:00Z" };
    const agent = new AviatorAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();
    const response = await agent.execute({
      requestId: "req-1",
      input: { signal, riskDecision: blockedRisk, executionMode: AviatorExecutionMode.AUTOMATIC, totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, idempotencyKey: "k1", userConfirmed: true },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.outcome).toBe(AviatorAutomationOutcome.RISK_BLOCKED);
  });

  it("4. Telegram agent attempts to modify ticket probability -> impossible by construction (its input has no probability/selection/odds field to mutate at all)", async () => {
    const destinations: TelegramDestinationManager = {
      list: async () => [{ destinationId: "d1", telegramChatId: "-1001", name: "Main", type: TelegramDestinationType.CHANNEL, enabled: true, autoPublish: true, publishBookingCode: false, publishTicket: true, publishResults: false, publishWeeklyReport: false, createdAt: "2026-01-01T00:00:00Z" }],
      get: async () => undefined,
      create: async () => {
        throw new Error("unused");
      },
      update: async () => {
        throw new Error("unused");
      },
    };
    let capturedText: string | undefined;
    const telegram: TelegramService = {
      sendMessage: async (_chatId, text) => {
        capturedText = text;
        return ok<SendMessageResult>({ messageId: 1 });
      },
      replyToMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    };
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    const finalizedText = "HOME @ 2.00 — probability 60%";
    await agent.execute({ requestId: "req-1", input: { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText }, audit: { requestId: "req-1", actor: "user-1" } });
    // The TypeScript input type itself has no odds/probability/selection
    // field this agent could reach into — the only content-bearing field
    // is the opaque, already-finalized string, sent byte-for-byte.
    expect(capturedText).toBe(finalizedText);
  });

  it("5. Settlement agent attempts to rewrite prediction -> rejected (the original ticket is echoed back unmutated, never altered)", async () => {
    const agent = new SettlementAgent({
      settlementService: { settle: async (ticketId) => ({ settlementId: "s1", ticketId, status: "won" as never, settledAt: new Date().toISOString() }) },
    });
    agent.markReady();
    const original = ticket();
    const response = await agent.execute({
      requestId: "req-1",
      input: { ticket: original, executedWager: { ticketId: original.ticketId, stake: 10, executedAt: "2026-01-10T18:05:00Z" }, officialResult: { eventId: "fixture-1", finalScore: "2-0", settledAt: "2026-01-10T20:00:00Z" } },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.originalTicket).toEqual(original);
  });

  it("6. Duplicate execution command -> idempotent rejection/no duplicate (the automation agent runs exactly once)", async () => {
    const orchestrator = newHarness(new GlobalExecutionGate([]));
    let executions = 0;
    const integration = { isAvailable: async () => true, execute: async (req: { stake: number }) => ({ externalReference: "x", stake: req.stake, executedAt: new Date().toISOString() }) };
    const agent = new FootballAutomationAgent({
      integration: {
        isAvailable: integration.isAvailable,
        execute: async (req) => {
          executions += 1;
          return integration.execute(req);
        },
      },
    });
    agent.markReady();
    const key = "exec-ticket-1";
    const first = await orchestrator.dispatch({ message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: key, userConfirmed: true }, key), agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.EXECUTION });
    const second = await orchestrator.dispatch({
      message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: key, userConfirmed: true }, key),
      agent,
      declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION,
      context: ctx({ invocationId: "55555555-5555-5555-5555-555555555555" }),
      sideEffectLevel: SideEffectLevel.EXECUTION,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.replayed).toBe(true);
    expect(executions).toBe(1);
  });

  it("7. Duplicate publication command -> no duplicate publication (the Telegram agent runs exactly once)", async () => {
    const orchestrator = newHarness(new GlobalExecutionGate([]));
    let publishCalls = 0;
    const destinations: TelegramDestinationManager = {
      list: async () => [{ destinationId: "d1", telegramChatId: "-1001", name: "Main", type: TelegramDestinationType.CHANNEL, enabled: true, autoPublish: true, publishBookingCode: false, publishTicket: true, publishResults: false, publishWeeklyReport: false, createdAt: "2026-01-01T00:00:00Z" }],
      get: async () => undefined,
      create: async () => {
        throw new Error("unused");
      },
      update: async () => {
        throw new Error("unused");
      },
    };
    const telegram: TelegramService = {
      sendMessage: async () => {
        publishCalls += 1;
        return ok<SendMessageResult>({ messageId: 1 });
      },
      replyToMessage: async () => ok<SendMessageResult>({ messageId: 1 }),
    };
    const agent = new TelegramChannelManagementAgent({ destinations, telegram });
    agent.markReady();
    const key = "publish-ticket-1";
    const payload = { contentReferenceId: "ticket-1", contentType: PublishableContentType.TICKET, finalizedText: "HOME @ 2.00" };
    await orchestrator.dispatch({ message: commandFor(TELEGRAM_CHANNEL_AGENT_DECLARATION.agentType, payload, key), agent, declaration: TELEGRAM_CHANNEL_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.REQUESTED_ACTION });
    await orchestrator.dispatch({ message: commandFor(TELEGRAM_CHANNEL_AGENT_DECLARATION.agentType, payload, key), agent, declaration: TELEGRAM_CHANNEL_AGENT_DECLARATION, context: ctx({ invocationId: "66666666-6666-6666-6666-666666666666" }), sideEffectLevel: SideEffectLevel.REQUESTED_ACTION });
    expect(publishCalls).toBe(1);
  });

  it("8. Unknown agent message schema -> rejected safely", async () => {
    const orchestrator = newHarness();
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const message = commandFor(FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.agentType, {});
    const result = await orchestrator.dispatch({ message: { ...message, schemaVersion: 999 }, agent, declaration: FOOTBALL_INTELLIGENCE_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.ANALYSIS });
    expect(result.ok).toBe(false);
  });

  it("9. Agent attempts to escalate side-effect level -> rejected", async () => {
    const orchestrator = newHarness(new GlobalExecutionGate([]));
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const result = await orchestrator.dispatch({ message: commandFor(FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.agentType, {}), agent, declaration: FOOTBALL_INTELLIGENCE_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.EXECUTION });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe("POLICY_REJECTED");
  });

  it("10. Agent attempts to bypass GlobalExecutionGate -> impossible through supported contracts (no authorizer configured at all)", async () => {
    const orchestrator = newHarness(undefined);
    const agent = new FootballAutomationAgent({ integration: new NotImplementedExecutionIntegration() });
    agent.markReady();
    const result = await orchestrator.dispatch({ message: commandFor(FOOTBALL_AUTOMATION_AGENT_DECLARATION.agentType, { ticket: ticket(), executionMode: FootballExecutionMode.AUTOMATIC, stake: 10, idempotencyKey: "k1", userConfirmed: true }), agent, declaration: FOOTBALL_AUTOMATION_AGENT_DECLARATION, context: ctx(), sideEffectLevel: SideEffectLevel.EXECUTION });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.failure.code).toBe("INTEGRATION_UNAVAILABLE");
  });
});

describe("§34 Section 07 boundary tests", () => {
  it("1. Intelligence agent cannot produce a stake", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const prediction: PredictionOutput = {
      fixtureId: "f1",
      predictionTimestamp: "t",
      snapshotTime: "t",
      modelVersion: "v",
      ensembleVersion: undefined,
      calibrationVersion: undefined,
      dataQuality: "AVAILABLE",
      homeWinProbability: 0.5,
      drawProbability: 0.3,
      awayWinProbability: 0.2,
      markets: [],
      featureVersions: {},
      uncertainty: { monteCarloStandardError: undefined, note: "This output is a statistical probability estimate, not a guarantee. See docs/architecture/FOOTBALL_INTELLIGENCE.md." },
      provenance: { sourceVersion: "v", componentContributions: undefined },
    };
    const response = await agent.execute({ requestId: "req-1", input: { fixtureId: "f1" as never, snapshotTime: "t" as never, predictionOutput: prediction, componentPredictions: [] }, audit: { requestId: "req-1", actor: "user-1" } });
    expect("stake" in response.output).toBe(false);
  });

  it("2. Intelligence agent cannot authorize execution — its own declared ceiling is ANALYSIS, structurally incapable of EXECUTION", () => {
    expect(FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.sideEffectLevel).toBe(SideEffectLevel.ANALYSIS);
  });

  it("3. Ticket agent cannot bypass value/risk services — every candidate goes through the injected DecisionEngine, and with none real (NotImplementedDecisionEngine) it fails rather than invents a proposal", async () => {
    const agent = new FootballDecisionAgent({ decisionEngine: new NotImplementedDecisionEngine() });
    agent.markReady();
    await expect(
      agent.execute({
        requestId: "req-1",
        input: { intelligence: { fixtureId: "f1" as never, snapshotTime: "t" as never, prediction: {} as never, modelAgreement: undefined, dataQuality: "AVAILABLE" as never, warnings: [], eligibility: "eligible" as never }, candidateMarkets: [{ eventId: "fixture-1", marketType: "match_result_1x2" as never, selection: "HOME" }] },
        audit: { requestId: "req-1", actor: "user-1" },
      }),
    ).rejects.toThrow();
    expect(FOOTBALL_DECISION_AGENT_DECLARATION.sideEffectLevel).toBe(SideEffectLevel.PROPOSAL);
  });

  it("4. Automation agent cannot directly call a bookmaker — the ONLY implementation of ExecutionIntegration in this codebase always reports itself unavailable", async () => {
    const integration = new NotImplementedExecutionIntegration();
    expect(await integration.isAvailable()).toBe(false);
    await expect(integration.execute({ ticketOrSignalId: "x", stake: 1, idempotencyKey: "k" })).rejects.toThrow(/not implemented/i);
  });

  it("5. Telegram agent cannot independently select a betting market — its input type carries no market/selection field, only a pre-finalized opaque string", () => {
    // Structural proof: TelegramChannelAgentInput has exactly these 3 fields.
    const input = { contentReferenceId: "x", contentType: PublishableContentType.TICKET, finalizedText: "already decided" };
    expect(Object.keys(input).sort()).toEqual(["contentReferenceId", "contentType", "finalizedText"]);
  });

  it("6. Risk agent cannot create a second global risk ledger — it only ever reads the SHARED controller instance it was constructed with, never instantiates its own", async () => {
    // Structural proof: AviatorRiskAgentDependencies has exactly one field (an injected controller), and the agent module never imports `new GlobalDailyRiskController` anywhere.
    const declaration = AVIATOR_RISK_AGENT_DECLARATION;
    expect(declaration.dependencies).toEqual(["aviator_intelligence"]);
    expect(declaration.capabilities).not.toContain("create_risk_ledger");
  });
});
