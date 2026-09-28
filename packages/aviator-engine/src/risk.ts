/**
 * Aviator-specific risk boundary (Section 01 — Aviator Engine Boundary).
 * Distinct from @sport-os/risk-engine's cross-sport
 * GlobalDailyRiskController — this is per-signal sizing/risk logic
 * specific to Aviator's round-based structure. No sizing logic is
 * implemented yet.
 */
export interface AviatorRiskDecision {
  readonly approved: boolean;
  readonly maxStake: number | null;
  readonly reason: string;
}

export interface AviatorRiskEngine {
  evaluate(signalId: string): Promise<AviatorRiskDecision>;
}
