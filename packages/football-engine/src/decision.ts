import { NotImplementedError } from "@sport-os/shared";
import type { MarketType } from "@sport-os/market-engine";

/**
 * Value/Decision-Ticket Engine boundary (Section 01 — Football Engine
 * Boundary). Decides whether a calibrated probability represents value
 * against current market odds, and whether it qualifies to become a
 * published Ticket (see @sport-os/settlement-engine). No decision logic
 * is implemented yet — this is intentionally the last, most consequential
 * boundary in the football pipeline and depends on every stage above it.
 */
export interface ValueAssessment {
  readonly eventId: string;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly calibratedProbability: number;
  readonly marketOdds: number | null;
  readonly expectedValue: number | null;
  readonly qualifies: boolean;
}

export interface DecisionEngine {
  assess(eventId: string, marketType: MarketType, selection: string): Promise<ValueAssessment>;
}

/**
 * The explicit NOT_AVAILABLE stub (Section 06 — Football Decision/Ticket
 * Agent, §9: "may request value calculations from the appropriate
 * Section 07 boundary... must not bypass the Value Engine"). Additive,
 * backward-compatible with Section 01's contract-only `DecisionEngine` —
 * every method throws `NotImplementedError` rather than fabricating a
 * value assessment, matching every other `NotImplemented*` stub in this
 * codebase (`NotImplementedTicketService`, `NotImplementedMarketService`,
 * ...). `@sport-os/agents`' Football Decision Agent depends on this
 * interface via injection; when given this stub, it surfaces a typed
 * DATA_UNAVAILABLE/INTEGRATION_UNAVAILABLE failure rather than
 * proceeding, never a silently-invented value assessment.
 */
export class NotImplementedDecisionEngine implements DecisionEngine {
  async assess(_eventId: string, _marketType: MarketType, _selection: string): Promise<ValueAssessment> {
    throw new NotImplementedError("DecisionEngine.assess");
  }
}
