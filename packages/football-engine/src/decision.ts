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
