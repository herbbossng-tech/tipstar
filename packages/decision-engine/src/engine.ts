import { DecisionStatus, IntelligenceResultStatus, type DecisionOutcome, type IntelligenceResult } from "@tipstar/types";
import { DEFAULT_DECISION_CRITERIA, type DecisionCriteria } from "./criteria.js";

const DECISION_ENGINE_VERSION = "decision-engine@0.1.0";

/**
 * The single, common Decision Engine every agent's IntelligenceResult must
 * pass through before it can become a published Pick (Section 12). Never
 * forces a prediction when evidence is weak — it degrades to WAIT,
 * MONITOR, or INSUFFICIENT_DATA instead of QUALIFIED.
 */
export class DecisionEngine {
  constructor(private readonly criteria: DecisionCriteria = DEFAULT_DECISION_CRITERIA) {}

  evaluate(result: IntelligenceResult, now: Date = new Date()): DecisionOutcome {
    const reasons: string[] = [];

    const build = (status: DecisionStatus): DecisionOutcome => ({
      intelligenceResultId: result.id,
      status,
      reasons,
      evaluatedAt: now.toISOString(),
      decisionEngineVersion: DECISION_ENGINE_VERSION,
    });

    if (result.status === IntelligenceResultStatus.ERROR) {
      reasons.push("Intelligence result reported an error.");
      return build(DecisionStatus.INSUFFICIENT_DATA);
    }

    if (result.status === IntelligenceResultStatus.INSUFFICIENT_DATA) {
      reasons.push("Agent reported insufficient data to generate a result.");
      return build(DecisionStatus.INSUFFICIENT_DATA);
    }

    if (result.evidence.length < this.criteria.minEvidenceCount) {
      reasons.push(`Evidence count ${result.evidence.length} below minimum ${this.criteria.minEvidenceCount}.`);
      return build(DecisionStatus.INSUFFICIENT_DATA);
    }

    const ageSeconds = (now.getTime() - new Date(result.generatedAt).getTime()) / 1000;
    if (ageSeconds > this.criteria.maxDataAgeSeconds) {
      reasons.push(`Result is stale (${Math.round(ageSeconds)}s old, max ${this.criteria.maxDataAgeSeconds}s).`);
      return build(DecisionStatus.WAIT);
    }

    if (this.criteria.requireMarketOdds && result.marketOdds === null) {
      reasons.push("Market odds are required but unavailable.");
      return build(DecisionStatus.WAIT);
    }

    if (result.probability === null || result.confidence === null) {
      reasons.push("Probability or confidence is unavailable.");
      return build(DecisionStatus.WAIT);
    }

    if (result.riskScore !== null && result.riskScore > this.criteria.maxRiskScore) {
      reasons.push(`Risk score ${result.riskScore} exceeds maximum ${this.criteria.maxRiskScore}.`);
      return build(DecisionStatus.NO_TRADE);
    }

    if (result.expectedValue !== null && result.expectedValue < this.criteria.minExpectedValue) {
      reasons.push(`Expected value ${result.expectedValue} below minimum ${this.criteria.minExpectedValue}.`);
      return build(DecisionStatus.NO_TRADE);
    }

    if (result.confidence < this.criteria.minConfidenceToReject) {
      reasons.push(`Confidence ${result.confidence} below reject threshold ${this.criteria.minConfidenceToReject}.`);
      return build(DecisionStatus.REJECTED);
    }

    if (result.confidence < this.criteria.minConfidenceToQualify) {
      reasons.push(`Confidence ${result.confidence} below qualify threshold ${this.criteria.minConfidenceToQualify}; monitoring.`);
      return build(DecisionStatus.MONITOR);
    }

    reasons.push("All publication criteria satisfied.");
    return build(DecisionStatus.QUALIFIED);
  }
}
