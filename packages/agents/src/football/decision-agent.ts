import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import type { DecisionEngine, ValueAssessment } from "@sport-os/football-engine";
import type { MarketType } from "@sport-os/market-engine";
import { Entitlement } from "@sport-os/platform";
import { generateId, type ISODateString, type UUID } from "@sport-os/shared";
import type { TicketSelection } from "@sport-os/settlement-engine";
import type { FootballIntelligenceResult } from "./intelligence-agent.js";

/**
 * Football Decision/Ticket Agent (Section 06 §9). Sits between
 * intelligence and Section 07's actual decision/risk/execution boundary.
 * "May: consume finalized intelligence, request value calculations from
 * the appropriate Section 07 boundary [`DecisionEngine`, football-engine/
 * decision.ts], compare candidate markets, create a ticket proposal...
 * Must NOT bypass: Value Engine, Risk Engine, GlobalExecutionGate,
 * license checks, entitlement checks."
 *
 * Every value judgment ("does this selection have positive expected
 * value") is delegated to the injected `DecisionEngine` — this agent
 * never computes expected value itself. `requiredEntitlements` on the
 * declaration is what the orchestrator/`GlobalExecutionGate` check
 * before this agent ever runs; nothing here re-checks license/
 * entitlement/risk inline (§25: "do not duplicate licensing logic
 * inside agents").
 *
 * "PREDICTION ≠ TICKET PROPOSAL ≠ EXECUTED TICKET" — `TicketProposal`
 * below is a NEW, agent-layer type, deliberately never
 * `@sport-os/settlement-engine`'s `Ticket` (which already means
 * "published") or `ExecutedWager`. A proposal this agent produces has
 * not been validated, risk-checked, published, or executed by anything.
 */

export interface CandidateMarket {
  readonly eventId: string;
  readonly marketType: MarketType;
  readonly selection: string;
}

export interface TicketProposal {
  readonly proposalId: UUID;
  readonly fixtureId: UUID;
  /** Only the candidate markets `DecisionEngine.assess()` reported as `qualifies: true` — never every candidate blindly included. */
  readonly legs: readonly TicketSelection[];
  /** Every assessment this proposal considered, qualifying or not — full provenance of why a candidate was included or excluded. */
  readonly valueAssessments: readonly ValueAssessment[];
  /** True only when at least one leg qualified — "eligible for further validation" per §9, NEVER "authorized" or "executed." */
  readonly eligibleForValidation: boolean;
  readonly createdAt: ISODateString;
}

export interface FootballDecisionAgentInput {
  readonly intelligence: FootballIntelligenceResult;
  readonly candidateMarkets: readonly CandidateMarket[];
}

export interface FootballDecisionAgentDependencies {
  readonly decisionEngine: DecisionEngine;
}

export const FOOTBALL_DECISION_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "football-decision-agent",
  agentType: "football_decision",
  version: "0.1.0",
  capabilities: ["consume_intelligence", "request_value_analysis", "construct_candidate_ticket", "request_risk_validation"],
  requiredEntitlements: [Entitlement.FOOTBALL_ANALYSIS, Entitlement.FOOTBALL_TICKETS],
  allowedInputs: ["REQUEST_VALUE_ANALYSIS"],
  allowedOutputs: ["TICKET_PROPOSED"],
  dependencies: ["football_intelligence"],
  // A ticket PROPOSAL, never a placed wager — PROPOSAL is this agent's ceiling.
  sideEffectLevel: SideEffectLevel.PROPOSAL,
};

export class FootballDecisionAgent extends BaseAgent<FootballDecisionAgentInput, TicketProposal> {
  constructor(
    private readonly deps: FootballDecisionAgentDependencies,
    agentId: string = FOOTBALL_DECISION_AGENT_DECLARATION.agentId,
  ) {
    super({ agentId, agentType: FOOTBALL_DECISION_AGENT_DECLARATION.agentType, name: "Football Decision/Ticket Agent", version: FOOTBALL_DECISION_AGENT_DECLARATION.version, capabilities: FOOTBALL_DECISION_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<FootballDecisionAgentInput>): Promise<AgentResponse<TicketProposal>> {
    const { input } = request;

    const valueAssessments: ValueAssessment[] = [];
    for (const candidate of input.candidateMarkets) {
      const assessment = await this.deps.decisionEngine.assess(candidate.eventId, candidate.marketType, candidate.selection);
      valueAssessments.push(assessment);
    }

    const legs: TicketSelection[] = valueAssessments
      .filter((assessment) => assessment.qualifies)
      .map((assessment) => ({
        selectionId: generateId(),
        eventId: assessment.eventId,
        market: assessment.marketType,
        selection: assessment.selection,
        oddsAtPublication: assessment.marketOdds,
      }));

    const proposal: TicketProposal = {
      proposalId: generateId(),
      fixtureId: input.intelligence.fixtureId,
      legs,
      valueAssessments,
      eligibleForValidation: legs.length > 0,
      createdAt: new Date().toISOString(),
    };
    return { requestId: request.requestId, output: proposal, completedAt: new Date().toISOString() };
  }
}
