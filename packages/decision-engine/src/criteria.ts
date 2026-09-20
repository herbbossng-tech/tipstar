/**
 * Publication standards enforced uniformly across every agent. Agent-specific
 * intelligence stays inside each agent (@tipstar/intelligence); this is the
 * one place that decides whether a result is fit to publish.
 */
export interface DecisionCriteria {
  /** Below this, a result is rejected outright as too uncertain to act on. */
  readonly minConfidenceToReject: number;
  /** Between minConfidenceToReject and this, a result is held for monitoring rather than published or rejected. */
  readonly minConfidenceToQualify: number;
  readonly minExpectedValue: number;
  readonly maxRiskScore: number;
  readonly minEvidenceCount: number;
  readonly maxDataAgeSeconds: number;
  readonly requireMarketOdds: boolean;
}

export const DEFAULT_DECISION_CRITERIA: DecisionCriteria = {
  minConfidenceToReject: 0.2,
  minConfidenceToQualify: 0.55,
  minExpectedValue: 0.02,
  maxRiskScore: 0.75,
  minEvidenceCount: 1,
  maxDataAgeSeconds: 60 * 60, // 1 hour
  requireMarketOdds: true,
};
