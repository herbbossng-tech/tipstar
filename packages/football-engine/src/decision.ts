import { checkOddsValidity, computeFairOdds as computeMarketFairOdds, computeImpliedProbability, type MarketObservation, type MarketType, type OddsValidityConfig, type OddsValidityFailureReason } from "@sport-os/market-engine";
import { NotImplementedError, type ISODateString, type UUID } from "@sport-os/shared";
import type { FeatureQuality } from "./features/types.js";
import { mapProbabilityToMarket, type ProbabilityInputs } from "./market-mapping.js";

/**
 * Value/Decision Engine (Section 01 contract; real implementation added
 * Section 07). "Probability is NOT a decision. Confidence is NOT value.
 * Value is NOT risk authorization." — this module implements exactly
 * two of the pipeline's layers, VALUE and DECISION, and stops there: it
 * never touches risk (§21 — "VALUE and RISK must remain separate
 * outputs"; see `@sport-os/risk-engine`'s `ticket-risk-engine.ts` for
 * that layer) and never produces a Ticket, an authorization, or an
 * execution (see `ticket-engine.ts` and `@sport-os/agents`).
 */

// ============================================================
// Value Engine (§7-11)
// ============================================================

export const ValueEligibility = {
  VALID: "valid",
  INVALID_ODDS: "invalid_odds",
  MARKET_UNSUPPORTED: "market_unsupported",
  PREDICTION_UNAVAILABLE: "prediction_unavailable",
} as const;
export type ValueEligibility = (typeof ValueEligibility)[keyof typeof ValueEligibility];

/** Every reason a `ValueAssessment`/`DecisionResult` can carry (§14) — a closed, named set, never a vague string like "AI doesn't like it." */
export const DecisionReasonCode = {
  EDGE_BELOW_THRESHOLD: "EDGE_BELOW_THRESHOLD",
  EV_BELOW_THRESHOLD: "EV_BELOW_THRESHOLD",
  ODDS_STALE: "ODDS_STALE",
  ODDS_MISSING: "ODDS_MISSING",
  ODDS_INVALID: "ODDS_INVALID",
  MARKET_SUSPENDED: "MARKET_SUSPENDED",
  MARKET_CANCELLED: "MARKET_CANCELLED",
  DATA_QUALITY_LOW: "DATA_QUALITY_LOW",
  MODEL_DISAGREEMENT: "MODEL_DISAGREEMENT",
  MARKET_UNSUPPORTED: "MARKET_UNSUPPORTED",
  INSUFFICIENT_HISTORY: "INSUFFICIENT_HISTORY",
  PREDICTION_UNAVAILABLE: "PREDICTION_UNAVAILABLE",
  RISK_LIMIT: "RISK_LIMIT",
  DAILY_STOP_LOSS: "DAILY_STOP_LOSS",
  DAILY_TARGET_REACHED: "DAILY_TARGET_REACHED",
  EXECUTION_UNAVAILABLE: "EXECUTION_UNAVAILABLE",
} as const;
export type DecisionReasonCode = (typeof DecisionReasonCode)[keyof typeof DecisionReasonCode];

/** The Decision Engine's possible outcomes (§13) — "Only use states appropriate to the existing architecture. Do not use 'BET' as equivalent to 'EXECUTE'." A BET decision still requires ticket validation, risk validation, and execution authorization before anything real happens. */
export const DecisionOutcome = {
  BET: "BET",
  NO_EDGE: "NO_EDGE",
  WAIT: "WAIT",
  NO_TRADE: "NO_TRADE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  MARKET_UNSUPPORTED: "MARKET_UNSUPPORTED",
  RISK_REJECTED: "RISK_REJECTED",
} as const;
export type DecisionOutcome = (typeof DecisionOutcome)[keyof typeof DecisionOutcome];

export const VALUE_CALCULATION_VERSION = "value-engine-v1";

/**
 * The full structured Value + Decision result (Section 07 §8, §13) for
 * one (fixture, market, selection). Additive to Section 01/06's
 * `ValueAssessment` shape — `eventId`/`marketType`/`selection`/
 * `calibratedProbability`/`marketOdds`/`expectedValue`/`qualifies` are
 * UNCHANGED (existing callers, `@sport-os/agents`' Football Decision
 * Agent among them, keep working exactly as before); every field below
 * `qualifies` is new. `qualifies` remains `decision === DecisionOutcome.BET`
 * — the same boolean the Football Decision Agent already filters on.
 */
export interface ValueAssessment {
  readonly eventId: string;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly line: number | undefined;
  /** Null only when `eligibility !== VALID` (e.g. no prediction exists at all) — never a fabricated probability. */
  readonly calibratedProbability: number | null;
  readonly marketOdds: number | null;
  readonly fairOdds: number | undefined;
  /** model_probability - implied_probability (§9) — a SEPARATE field from `expectedValue`, never conflated with it. Null whenever either input is unavailable. */
  readonly edge: number | null;
  /** (probability × odds) - 1 (§8). Null whenever odds are invalid/missing — NEVER computed from stale or suspended odds. */
  readonly expectedValue: number | null;
  readonly dataQuality: FeatureQuality | undefined;
  readonly oddsTimestamp: ISODateString | undefined;
  readonly modelVersion: string | undefined;
  readonly calculationVersion: string;
  readonly eligibility: ValueEligibility;
  readonly decision: DecisionOutcome;
  readonly reasons: readonly DecisionReasonCode[];
  readonly evaluatedAt: ISODateString;
  /** true iff `decision === BET` — the exact boolean `@sport-os/agents`' Football Decision Agent already filters ticket legs on. */
  readonly qualifies: boolean;
}

export interface DecisionEngine {
  assess(eventId: string, marketType: MarketType, selection: string): Promise<ValueAssessment>;
}

/**
 * The explicit NOT_AVAILABLE stub (Section 06 — Football Decision/Ticket
 * Agent, §9). Additive, backward-compatible with Section 01's
 * contract-only `DecisionEngine` — every method throws
 * `NotImplementedError` rather than fabricating a value assessment.
 * `StandardDecisionEngine` below is the real implementation Section 07
 * adds; this stub remains for any caller (or test) that deliberately
 * exercises the "no Value Engine available" path.
 */
export class NotImplementedDecisionEngine implements DecisionEngine {
  async assess(_eventId: string, _marketType: MarketType, _selection: string): Promise<ValueAssessment> {
    throw new NotImplementedError("DecisionEngine.assess");
  }
}

// ============================================================
// Configuration (§12, §35) — thresholds are configuration, never
// hard-coded business logic.
// ============================================================

export interface DecisionPolicy {
  readonly minimumEdge: number;
  readonly minimumExpectedValue: number;
  readonly minimumDataQuality: readonly FeatureQuality[];
  /** 0-1; undefined disables the check (no model-agreement signal available for this call). */
  readonly minimumModelAgreementRatio: number | undefined;
  readonly oddsValidity: OddsValidityConfig;
  readonly policyVersion: string;
}

export interface PredictionSnapshot {
  readonly fixtureId: UUID;
  readonly snapshotTime: ISODateString;
  readonly modelVersion: string;
  readonly dataQuality: FeatureQuality;
  readonly probabilityInputs: ProbabilityInputs;
  /** From `@sport-os/agents`' `FootballIntelligenceResult.modelAgreement.agreementRatio`, when available (Section 06) — kept optional and never invented when absent. */
  readonly modelAgreementRatio?: number;
}

export interface ValueEngineDependencies {
  getPredictionSnapshot(fixtureId: UUID): Promise<PredictionSnapshot | undefined>;
  getMarketObservation(fixtureId: UUID, marketType: MarketType, selection: string, line?: number): Promise<MarketObservation | undefined>;
}

function oddsInvalidReason(reason: OddsValidityFailureReason): DecisionReasonCode {
  switch (reason) {
    case "MISSING_ODDS":
      return DecisionReasonCode.ODDS_MISSING;
    case "MARKET_SUSPENDED":
      return DecisionReasonCode.MARKET_SUSPENDED;
    case "MARKET_CANCELLED":
      return DecisionReasonCode.MARKET_CANCELLED;
    case "STALE_ODDS":
      return DecisionReasonCode.ODDS_STALE;
    default:
      return DecisionReasonCode.ODDS_INVALID;
  }
}

/**
 * Evaluates one (fixture, market, selection): computes fair odds/edge/EV
 * from a real probability + a real market observation, applies every
 * odds-validity check (§10) before ever calculating a value figure, then
 * applies the configured `DecisionPolicy` thresholds (§12) to reach a
 * `DecisionOutcome` — never `RISK_REJECTED` (that is layered on
 * separately by `applyRiskRejection` below, after the Risk Engine runs;
 * §21: "VALUE and RISK must remain separate outputs").
 */
export async function evaluateValue(deps: ValueEngineDependencies, params: { readonly eventId: UUID; readonly marketType: MarketType; readonly selection: string; readonly line?: number | undefined; readonly now: ISODateString }, policy: DecisionPolicy): Promise<ValueAssessment> {
  const evaluatedAt = params.now;
  const snapshot = await deps.getPredictionSnapshot(params.eventId);
  if (!snapshot) {
    return {
      eventId: params.eventId,
      marketType: params.marketType,
      selection: params.selection,
      line: params.line,
      calibratedProbability: null,
      marketOdds: null,
      fairOdds: undefined,
      edge: null,
      expectedValue: null,
      dataQuality: undefined,
      oddsTimestamp: undefined,
      modelVersion: undefined,
      calculationVersion: VALUE_CALCULATION_VERSION,
      eligibility: ValueEligibility.PREDICTION_UNAVAILABLE,
      decision: DecisionOutcome.INSUFFICIENT_DATA,
      reasons: [DecisionReasonCode.PREDICTION_UNAVAILABLE],
      evaluatedAt,
      qualifies: false,
    };
  }

  const mapping = mapProbabilityToMarket(snapshot.probabilityInputs, params.marketType, params.line);
  if (!mapping.ok) {
    return {
      eventId: params.eventId,
      marketType: params.marketType,
      selection: params.selection,
      line: params.line,
      calibratedProbability: null,
      marketOdds: null,
      fairOdds: undefined,
      edge: null,
      expectedValue: null,
      dataQuality: snapshot.dataQuality,
      oddsTimestamp: undefined,
      modelVersion: snapshot.modelVersion,
      calculationVersion: VALUE_CALCULATION_VERSION,
      eligibility: ValueEligibility.MARKET_UNSUPPORTED,
      decision: DecisionOutcome.MARKET_UNSUPPORTED,
      reasons: [DecisionReasonCode.MARKET_UNSUPPORTED],
      evaluatedAt,
      qualifies: false,
    };
  }
  const marketProbability = mapping.markets.find((m) => m.selection === params.selection);
  const probability = marketProbability?.probability ?? null;
  const fairOdds = probability !== null ? computeMarketFairOdds(probability) : undefined;

  const observation = await deps.getMarketObservation(params.eventId, params.marketType, params.selection, params.line);
  const reasons: DecisionReasonCode[] = [];

  if (probability === null) {
    reasons.push(DecisionReasonCode.MARKET_UNSUPPORTED);
    return {
      eventId: params.eventId,
      marketType: params.marketType,
      selection: params.selection,
      line: params.line,
      calibratedProbability: null,
      marketOdds: observation?.odds ?? null,
      fairOdds: undefined,
      edge: null,
      expectedValue: null,
      dataQuality: snapshot.dataQuality,
      oddsTimestamp: observation?.oddsTimestamp,
      modelVersion: snapshot.modelVersion,
      calculationVersion: VALUE_CALCULATION_VERSION,
      eligibility: ValueEligibility.MARKET_UNSUPPORTED,
      decision: DecisionOutcome.MARKET_UNSUPPORTED,
      reasons,
      evaluatedAt,
      qualifies: false,
    };
  }

  if (!observation) {
    return {
      eventId: params.eventId,
      marketType: params.marketType,
      selection: params.selection,
      line: params.line,
      calibratedProbability: probability,
      marketOdds: null,
      fairOdds,
      edge: null,
      expectedValue: null,
      dataQuality: snapshot.dataQuality,
      oddsTimestamp: undefined,
      modelVersion: snapshot.modelVersion,
      calculationVersion: VALUE_CALCULATION_VERSION,
      eligibility: ValueEligibility.INVALID_ODDS,
      decision: DecisionOutcome.WAIT,
      reasons: [DecisionReasonCode.ODDS_MISSING],
      evaluatedAt,
      qualifies: false,
    };
  }

  const validity = checkOddsValidity(observation, evaluatedAt, policy.oddsValidity);
  if (!validity.valid) {
    return {
      eventId: params.eventId,
      marketType: params.marketType,
      selection: params.selection,
      line: params.line,
      calibratedProbability: probability,
      marketOdds: observation.odds,
      fairOdds,
      edge: null,
      expectedValue: null,
      dataQuality: snapshot.dataQuality,
      oddsTimestamp: observation.oddsTimestamp,
      modelVersion: snapshot.modelVersion,
      calculationVersion: VALUE_CALCULATION_VERSION,
      eligibility: ValueEligibility.INVALID_ODDS,
      decision: DecisionOutcome.WAIT,
      reasons: [oddsInvalidReason(validity.reason)],
      evaluatedAt,
      qualifies: false,
    };
  }

  // Real odds, real probability — the ONLY point EV/edge are ever computed.
  const impliedProbability = computeImpliedProbability(observation.odds)!;
  const edge = probability - impliedProbability;
  const expectedValue = probability * observation.odds! - 1;

  if (!policy.minimumDataQuality.includes(snapshot.dataQuality)) {
    reasons.push(DecisionReasonCode.DATA_QUALITY_LOW);
  }
  if (policy.minimumModelAgreementRatio !== undefined && snapshot.modelAgreementRatio !== undefined && snapshot.modelAgreementRatio < policy.minimumModelAgreementRatio) {
    reasons.push(DecisionReasonCode.MODEL_DISAGREEMENT);
  }
  if (edge < policy.minimumEdge) {
    reasons.push(DecisionReasonCode.EDGE_BELOW_THRESHOLD);
  }
  if (expectedValue < policy.minimumExpectedValue) {
    reasons.push(DecisionReasonCode.EV_BELOW_THRESHOLD);
  }

  const hardBlock = reasons.includes(DecisionReasonCode.DATA_QUALITY_LOW) ? DecisionOutcome.INSUFFICIENT_DATA : reasons.includes(DecisionReasonCode.MODEL_DISAGREEMENT) ? DecisionOutcome.NO_TRADE : undefined;
  const decision = hardBlock ?? (reasons.length > 0 ? DecisionOutcome.NO_EDGE : DecisionOutcome.BET);

  return {
    eventId: params.eventId,
    marketType: params.marketType,
    selection: params.selection,
    line: params.line,
    calibratedProbability: probability,
    marketOdds: observation.odds,
    fairOdds,
    edge,
    expectedValue,
    dataQuality: snapshot.dataQuality,
    oddsTimestamp: observation.oddsTimestamp,
    modelVersion: snapshot.modelVersion,
    calculationVersion: VALUE_CALCULATION_VERSION,
    eligibility: ValueEligibility.VALID,
    decision,
    reasons,
    evaluatedAt,
    qualifies: decision === DecisionOutcome.BET,
  };
}

/**
 * Applies a Risk Engine's verdict to an already-computed `ValueAssessment`
 * (§21: value and risk are separate outputs, combined only here, only
 * AFTER both have run independently). A ticket with positive EV/edge
 * (`decision: BET`) can still end up `RISK_REJECTED`; a risk-approved
 * assessment that was never `BET` in the first place is returned
 * unchanged — risk approval never manufactures value that wasn't there.
 */
export function applyRiskRejection(assessment: ValueAssessment, riskApproved: boolean, riskReason?: DecisionReasonCode): ValueAssessment {
  if (assessment.decision !== DecisionOutcome.BET || riskApproved) return assessment;
  return { ...assessment, decision: DecisionOutcome.RISK_REJECTED, reasons: [...assessment.reasons, riskReason ?? DecisionReasonCode.RISK_LIMIT], qualifies: false };
}

/**
 * Real, Section 07 implementation of `DecisionEngine`. Constructed with
 * the same `ValueEngineDependencies`/`DecisionPolicy` `evaluateValue`
 * needs — `assess()` is a thin wrapper so `@sport-os/agents`' Football
 * Decision Agent (unchanged since Section 06) can depend on this class
 * exactly as it already depends on the `DecisionEngine` interface.
 */
export class StandardDecisionEngine implements DecisionEngine {
  constructor(
    private readonly deps: ValueEngineDependencies,
    private readonly policy: DecisionPolicy,
    private readonly now: () => ISODateString = () => new Date().toISOString(),
  ) {}

  async assess(eventId: string, marketType: MarketType, selection: string): Promise<ValueAssessment> {
    return this.assessWithLine(eventId, marketType, selection, undefined);
  }

  /** The richer entry point (line-aware, e.g. for Over/Under) — not part of the `DecisionEngine` interface (which Section 06 already fixed without a `line` parameter), so callers that need it use this class directly rather than through the interface. */
  async assessWithLine(eventId: string, marketType: MarketType, selection: string, line: number | undefined): Promise<ValueAssessment> {
    return evaluateValue(this.deps, { eventId, marketType, selection, line, now: this.now() }, this.policy);
  }
}
