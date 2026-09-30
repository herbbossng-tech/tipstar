import type { ISODateString, UUID } from "@sport-os/shared";
import type { RiskControllerState } from "./global-daily-risk-controller.js";
import { GlobalDailyRiskController } from "./global-daily-risk-controller.js";
import type { RiskAssessment } from "./service.js";

/**
 * Ticket Risk Engine (Section 07 §20-21, §37). The REAL implementation
 * of Section 01's `RiskService` contract (`service.ts`) — "Use the
 * existing risk-engine. Do NOT create a second risk architecture."
 * Extends `RiskAssessment` additively (`approved`/`reason` are
 * unchanged); everything below is new.
 *
 * "VALUE and RISK must remain separate outputs" (§21) — this module
 * knows nothing about probability, EV, or edge; it only evaluates
 * exposure/limits/policy against a ticket's shape and the caller's
 * already-tracked daily state. A ticket with strong value can still be
 * `approved: false` here, and a risk-clean ticket can still have no
 * value at all — the two are combined only by
 * `football-engine/decision.ts`'s `applyRiskRejection`, never inside
 * this module.
 */

export const RiskCode = {
  APPROVED: "APPROVED",
  MAX_STAKE_EXCEEDED: "MAX_STAKE_EXCEEDED",
  MAX_DAILY_EXPOSURE_EXCEEDED: "MAX_DAILY_EXPOSURE_EXCEEDED",
  MAX_TICKETS_PER_DAY_EXCEEDED: "MAX_TICKETS_PER_DAY_EXCEEDED",
  MAX_ACCUMULATOR_LEGS_EXCEEDED: "MAX_ACCUMULATOR_LEGS_EXCEEDED",
  LEAGUE_RESTRICTED: "LEAGUE_RESTRICTED",
  MARKET_RESTRICTED: "MARKET_RESTRICTED",
  DATA_QUALITY_BELOW_MINIMUM: "DATA_QUALITY_BELOW_MINIMUM",
  MODEL_AGREEMENT_BELOW_MINIMUM: "MODEL_AGREEMENT_BELOW_MINIMUM",
  DAILY_STOP_LOSS_REACHED: "DAILY_STOP_LOSS_REACHED",
  DAILY_TARGET_REACHED: "DAILY_TARGET_REACHED",
} as const;
export type RiskCode = (typeof RiskCode)[keyof typeof RiskCode];

export interface TicketRiskLimits {
  readonly maxStake: number;
  readonly maxDailyExposure: number;
  readonly maxTicketsPerDay: number;
  readonly maxAccumulatorLegs: number;
  readonly minimumDataQuality: readonly string[];
  readonly minimumModelAgreementRatio: number | undefined;
  readonly restrictedCompetitionIds: readonly UUID[];
  readonly restrictedMarketTypes: readonly string[];
  readonly policyVersion: string;
}

export interface TicketRiskLegInput {
  readonly fixtureId: UUID;
  readonly competitionId: UUID | undefined;
  readonly marketType: string;
  /**
   * An explicit extension point for future correlated-exposure controls
   * (§37: "the risk engine should support future correlated exposure
   * controls... preserve structured fields... do not invent a
   * sophisticated correlation model if no validated implementation
   * exists"). Never read by any check in this module today — set by a
   * caller who wants the FIELD to exist for a future risk check to
   * consume, not because one exists yet.
   */
  readonly correlationGroup: string | undefined;
}

export interface TicketRiskInput {
  readonly ticketId: UUID;
  readonly legs: readonly TicketRiskLegInput[];
  readonly proposedStake: number;
  readonly dailyStakeSoFar: number;
  readonly dailyTicketCountSoFar: number;
  readonly worstDataQuality: string;
  readonly modelAgreementRatio: number | undefined;
}

export interface TicketRiskResult extends RiskAssessment {
  readonly riskCode: RiskCode;
  readonly reasons: readonly RiskCode[];
  readonly exposure: {
    readonly proposedStake: number;
    readonly projectedDailyStake: number;
    readonly projectedDailyTicketCount: number;
  };
  readonly limitsSnapshot: TicketRiskLimits;
  readonly evaluatedAt: ISODateString;
  readonly policyVersion: string;
}

/**
 * Deterministic (§20/§43): the same ticket + limits + daily state always
 * evaluates the same way. Collects EVERY violated limit (not just the
 * first) — a ticket that busts three limits at once should say so, not
 * pick one arbitrarily.
 */
export function evaluateTicketRisk(input: TicketRiskInput, limits: TicketRiskLimits, now: ISODateString): TicketRiskResult {
  const reasons: RiskCode[] = [];

  if (input.proposedStake > limits.maxStake) reasons.push(RiskCode.MAX_STAKE_EXCEEDED);
  const projectedDailyStake = input.dailyStakeSoFar + input.proposedStake;
  if (projectedDailyStake > limits.maxDailyExposure) reasons.push(RiskCode.MAX_DAILY_EXPOSURE_EXCEEDED);
  const projectedDailyTicketCount = input.dailyTicketCountSoFar + 1;
  if (projectedDailyTicketCount > limits.maxTicketsPerDay) reasons.push(RiskCode.MAX_TICKETS_PER_DAY_EXCEEDED);
  if (input.legs.length > limits.maxAccumulatorLegs) reasons.push(RiskCode.MAX_ACCUMULATOR_LEGS_EXCEEDED);

  const restrictedCompetitions = new Set(limits.restrictedCompetitionIds);
  if (input.legs.some((leg) => leg.competitionId !== undefined && restrictedCompetitions.has(leg.competitionId))) {
    reasons.push(RiskCode.LEAGUE_RESTRICTED);
  }
  const restrictedMarkets = new Set(limits.restrictedMarketTypes);
  if (input.legs.some((leg) => restrictedMarkets.has(leg.marketType))) {
    reasons.push(RiskCode.MARKET_RESTRICTED);
  }
  if (!limits.minimumDataQuality.includes(input.worstDataQuality)) {
    reasons.push(RiskCode.DATA_QUALITY_BELOW_MINIMUM);
  }
  if (limits.minimumModelAgreementRatio !== undefined && input.modelAgreementRatio !== undefined && input.modelAgreementRatio < limits.minimumModelAgreementRatio) {
    reasons.push(RiskCode.MODEL_AGREEMENT_BELOW_MINIMUM);
  }

  const approved = reasons.length === 0;
  return {
    approved,
    reason: approved ? "Ticket satisfies every configured risk limit." : `Ticket rejected: ${reasons.join(", ")}.`,
    riskCode: approved ? RiskCode.APPROVED : reasons[0]!,
    reasons,
    exposure: { proposedStake: input.proposedStake, projectedDailyStake, projectedDailyTicketCount },
    limitsSnapshot: limits,
    evaluatedAt: now,
    policyVersion: limits.policyVersion,
  };
}

/**
 * The Aviator side of §22 — reads the SHARED `GlobalDailyRiskController`
 * instance (never constructs its own; "do not create a second daily
 * controller... the controller must be authoritative for Aviator daily
 * risk"). Mirrors exactly `@sport-os/agents`' Aviator Risk Agent
 * (Section 06), re-exposed here as a `RiskService`-shaped result so
 * Aviator execution can go through the same `RiskAssessment` contract
 * football tickets do.
 */
export function evaluateAviatorDailyRisk(controller: GlobalDailyRiskController, now: ISODateString): TicketRiskResult {
  const state: RiskControllerState = controller.getState();
  const allowed = controller.isExecutionAllowed();
  const riskCode = allowed ? RiskCode.APPROVED : state === "daily_target_reached" ? RiskCode.DAILY_TARGET_REACHED : RiskCode.DAILY_STOP_LOSS_REACHED;
  const limits: TicketRiskLimits = { maxStake: Infinity, maxDailyExposure: Infinity, maxTicketsPerDay: Infinity, maxAccumulatorLegs: Infinity, minimumDataQuality: [], minimumModelAgreementRatio: undefined, restrictedCompetitionIds: [], restrictedMarketTypes: [], policyVersion: "aviator-daily-risk-v1" };
  return {
    approved: allowed,
    reason: allowed ? "GlobalDailyRiskController is ACTIVE." : `GlobalDailyRiskController reports ${state}.`,
    riskCode,
    reasons: allowed ? [] : [riskCode],
    exposure: { proposedStake: 0, projectedDailyStake: controller.getCumulativePnL(), projectedDailyTicketCount: 0 },
    limitsSnapshot: limits,
    evaluatedAt: now,
    policyVersion: limits.policyVersion,
  };
}
