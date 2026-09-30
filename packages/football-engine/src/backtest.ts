import { MarketType, MarketStatus, type MarketObservation } from "@sport-os/market-engine";
import { LedgerMode, SettlementStatus, computeNetPnl, computeRoi, computeClosingLineValue, type Money, type PerformanceRecordInput } from "@sport-os/settlement-engine";
import { generateId, ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import { accuracy1x2, brierScore1x2, logLoss1x2, type Evaluation1x2Prediction } from "./evaluation/metrics.js";
import type { TrainingExample } from "./dataset/types.js";
import { evaluateValue, DecisionOutcome, type DecisionPolicy, type ValueAssessment, type ValueEngineDependencies } from "./decision.js";
import type { ProbabilityInputs } from "./market-mapping.js";
import { createTicketDraft, ticketLegFromValueAssessment, type TicketLeg, type TicketRecord } from "./ticket-engine.js";
import { settleTicketLegs, type LegSettlement } from "./settlement.js";

/**
 * Backtesting / walk-forward settlement simulation (Section 08 §31-34).
 * This module does NOT retrain models, does NOT re-implement walk-forward
 * splitting, and does NOT recompute features — all of that is Section
 * 05's job (`validation/walk-forward.ts`'s `generateWalkForwardWindows`/
 * `splitExamplesByWindow`, `models/*.ts`, `dataset/builder.ts`), reused
 * as-is. The caller trains a real model per walk-forward window, predicts
 * on that window's held-out TEST examples, and resolves the REAL odds
 * that were actually available at each example's `snapshotTime` — THIS
 * module's only job is the layer Section 05 deliberately excluded: "Do
 * not use ROI or realized betting profit as the primary intelligence
 * metric... belongs to the later performance/backtesting layer." It
 * wires each (prediction, real decision-time odds, real historical
 * outcome) triple through the SAME real `evaluateValue()`/
 * `createTicketDraft()`/`settleTicketLegs()` this codebase uses for live
 * decisions — never a second, parallel decision/settlement
 * implementation for backtesting.
 *
 * Every simulated execution is unconditionally `LedgerMode.PAPER` — a
 * backtest can never write to a LIVE performance ledger (§22/§33).
 */

/**
 * A backtest decision point deliberately narrows to the three markets
 * `TrainingExample` actually labels (1X2, Over/Under, BTTS — Section 05's
 * own documented scope trim: "prioritize 1X2, total goals, BTTS"). Any
 * other market has no real historical label to settle against in this
 * codebase and is refused, not guessed (§10's "if required result data
 * is unavailable: PENDING. Do not guess," carried through to
 * backtesting).
 */
export interface BacktestDecisionPoint {
  readonly example: TrainingExample;
  /** The caller's real model output for this example's (fixtureId, snapshotTime) — never recomputed here. */
  readonly prediction: ProbabilityInputs;
  readonly marketType: typeof MarketType.MATCH_RESULT_1X2 | typeof MarketType.OVER_UNDER | typeof MarketType.BOTH_TEAMS_TO_SCORE;
  readonly selection: string;
  readonly line: number | undefined;
  /** The real odds available at decision time — resolved by the caller from a real `market_observations`/`odds_observations` snapshot, never fabricated. */
  readonly decisionOdds: number;
  /** Must be `<= example.snapshotTime` — enforced by `simulateBacktestDecision` (§32: "a backtest may use only odds that were actually available at the simulated decision time"). */
  readonly oddsTimestamp: ISODateString;
  /** The odds at market close, when the caller has resolved them — used ONLY for CLV (§28), never for the decision itself. `undefined` when unavailable; CLV is then correctly `undefined`, never fabricated. */
  readonly closingOdds?: number;
  readonly modelVersion: string;
  readonly dataQuality: string;
}

export interface BacktestTicketSimulation {
  readonly example: TrainingExample;
  readonly valueAssessment: ValueAssessment;
  /** `undefined` when the Value Engine's own decision was not `BET` — no ticket, no settlement; nothing here simulates an execution the real pipeline would never have made. */
  readonly ticket: TicketRecord | undefined;
  readonly settlement: BacktestSettlement | undefined;
  readonly closingLineValue: number | undefined;
}

export interface BacktestSettlement {
  readonly settlementId: UUID;
  readonly ticketId: UUID;
  readonly status: SettlementStatus;
  readonly leg: LegSettlement;
  readonly ledgerMode: typeof LedgerMode.PAPER;
  readonly stake: Money;
  readonly calculatedReturn: Money | null;
  readonly netPnl: Money | null;
  readonly roi: number | null;
  readonly settledAt: ISODateString;
}

/** Grades one backtest decision point against its `TrainingExample`'s own real, historical label — never re-derives an outcome from raw goals (Section 05's dataset builder is the sole source of these labels). */
function gradeAgainstTrainingExample(example: TrainingExample, marketType: BacktestDecisionPoint["marketType"], selection: string, line: number | undefined): { readonly status: SettlementStatus; readonly reason: string } {
  switch (marketType) {
    case MarketType.MATCH_RESULT_1X2:
      return selection === example.target1x2
        ? { status: SettlementStatus.WON, reason: `Historical label ${example.target1x2} matches selection.` }
        : { status: SettlementStatus.LOST, reason: `Historical label ${example.target1x2} does not match selection ${selection}.` };
    case MarketType.BOTH_TEAMS_TO_SCORE: {
      const actual = example.targetBtts ? "YES" : "NO";
      return selection === actual
        ? { status: SettlementStatus.WON, reason: `Historical BTTS label = ${example.targetBtts}.` }
        : { status: SettlementStatus.LOST, reason: `Historical BTTS label = ${example.targetBtts}, not ${selection}.` };
    }
    case MarketType.OVER_UNDER: {
      if (line === undefined) return { status: SettlementStatus.PENDING, reason: "Over/Under requires a line." };
      if (example.targetTotalGoals === line) return { status: SettlementStatus.PUSH, reason: `Historical total goals ${example.targetTotalGoals} exactly equals the line ${line}.` };
      const actual = example.targetTotalGoals > line ? "OVER" : "UNDER";
      return selection === actual
        ? { status: SettlementStatus.WON, reason: `Historical total goals ${example.targetTotalGoals} vs line ${line} resolved to ${actual}.` }
        : { status: SettlementStatus.LOST, reason: `Historical total goals ${example.targetTotalGoals} vs line ${line} resolved to ${actual}, not ${selection}.` };
    }
  }
}

export interface SimulateBacktestParams {
  readonly policy: DecisionPolicy;
  /** A fixed, caller-configured PAPER stake per ticket — never invented internally (§15/§33). */
  readonly stakePerTicket: number;
  readonly currency: string;
  readonly source: string;
  readonly now: () => ISODateString;
}

/**
 * Simulates exactly ONE decision, end to end, against real historical
 * data. Throws `ValidationError` (`BACKTEST_FUTURE_ODDS`) if
 * `oddsTimestamp` is after the example's own `snapshotTime` — a backtest
 * that reaches into the future for its odds is a leakage bug, not a
 * warning (§32).
 */
export async function simulateBacktestDecision(point: BacktestDecisionPoint, params: SimulateBacktestParams): Promise<BacktestTicketSimulation> {
  if (new Date(point.oddsTimestamp).getTime() > new Date(point.example.snapshotTime).getTime()) {
    throw new ValidationError({
      message: "Backtest odds timestamp is after the decision's snapshotTime — a backtest may only use odds that were actually available at decision time.",
      code: "BACKTEST_FUTURE_ODDS",
      context: { oddsTimestamp: point.oddsTimestamp, snapshotTime: point.example.snapshotTime },
    });
  }

  const observation: MarketObservation = {
    marketId: generateId(),
    marketType: point.marketType,
    fixtureId: point.example.fixtureId,
    selection: point.selection,
    line: point.line,
    odds: point.decisionOdds,
    oddsTimestamp: point.oddsTimestamp,
    source: "backtest",
    sourceObservationId: undefined,
    status: MarketStatus.OPEN,
    schemaVersion: 1,
  };
  const deps: ValueEngineDependencies = {
    getPredictionSnapshot: async () => ({
      fixtureId: point.example.fixtureId,
      snapshotTime: point.example.snapshotTime,
      modelVersion: point.modelVersion,
      dataQuality: point.dataQuality as never,
      probabilityInputs: point.prediction,
    }),
    getMarketObservation: async () => observation,
  };

  const assessment: ValueAssessment = await evaluateValue(deps, { eventId: point.example.fixtureId, marketType: point.marketType, selection: point.selection, line: point.line, now: point.example.snapshotTime }, params.policy);

  const closingLineValue = point.closingOdds !== undefined ? computeClosingLineValue({ decisionOdds: point.decisionOdds, closingOdds: point.closingOdds }) : undefined;

  if (assessment.decision !== DecisionOutcome.BET) {
    return { example: point.example, valueAssessment: assessment, ticket: undefined, settlement: undefined, closingLineValue };
  }

  const leg: TicketLeg = ticketLegFromValueAssessment(assessment);
  const ticket = createTicketDraft({ legs: [leg], createdBy: params.source, now: params.now });

  const outcome = gradeAgainstTrainingExample(point.example, point.marketType, point.selection, point.line);
  const legSettlement: LegSettlement = { legId: leg.legId, fixtureId: leg.fixtureId, marketType: leg.marketType, selection: leg.selection, line: leg.line, odds: leg.odds, status: outcome.status, resultVersionId: undefined, reason: outcome.reason };
  const aggregation = settleTicketLegs([legSettlement]);

  const stake: Money = { amount: params.stakePerTicket, currency: params.currency };
  const isResolved = aggregation.status === SettlementStatus.WON || aggregation.status === SettlementStatus.LOST || aggregation.status === SettlementStatus.VOID || aggregation.status === SettlementStatus.PUSH;
  let calculatedReturn: Money | null = null;
  if (isResolved) {
    if (aggregation.status === SettlementStatus.LOST) calculatedReturn = { amount: 0, currency: params.currency };
    else if (aggregation.status === SettlementStatus.VOID || aggregation.status === SettlementStatus.PUSH) calculatedReturn = stake;
    else if (aggregation.status === SettlementStatus.WON && aggregation.combinedMultiplier !== undefined) calculatedReturn = { amount: Math.round(stake.amount * aggregation.combinedMultiplier * 100) / 100, currency: params.currency };
  }
  // A backtest's "actual" IS its calculated paper return — there is no external provider to confirm it against, so the simulation treats its own calculation as the PAPER-ledger payout (never labeled PayoutSource.PROVIDER, which is reserved for a real integration).
  const netPnl = calculatedReturn !== null ? computeNetPnl(stake, calculatedReturn) : null;
  const roi = computeRoi(netPnl, stake);

  const settlement: BacktestSettlement = {
    settlementId: generateId(),
    ticketId: ticket.ticketId,
    status: aggregation.status,
    leg: legSettlement,
    ledgerMode: LedgerMode.PAPER,
    stake,
    calculatedReturn,
    netPnl,
    roi,
    settledAt: params.now(),
  };

  return { example: point.example, valueAssessment: assessment, ticket, settlement, closingLineValue };
}

/** Adapts a `BacktestSettlement` into the shape `@sport-os/settlement-engine`'s `buildPerformanceLedgerEntry()` aggregates — the SAME aggregator every live/paper performance ledger entry uses, never a second one for backtests. */
export function backtestToPerformanceRecordInput(simulation: BacktestTicketSimulation): PerformanceRecordInput | undefined {
  if (!simulation.settlement) return undefined;
  return {
    status: simulation.settlement.status,
    ledgerMode: LedgerMode.PAPER,
    legCount: 1,
    executed: true,
    actualStake: simulation.settlement.stake,
    actualPayout: simulation.settlement.calculatedReturn !== null ? simulation.settlement.calculatedReturn : null,
    expectedEv: simulation.valueAssessment.expectedValue ?? undefined,
    settledAt: simulation.settlement.settledAt,
  };
}

export interface BacktestPredictiveMetrics {
  readonly sampleCount: number;
  readonly accuracy: number | null;
  readonly logLoss: number | null;
  readonly brierScore: number | null;
}

/**
 * Reuses Section 05's real evaluation metrics (`evaluation/metrics.ts`)
 * over every 1X2 decision point in a backtest run — never a second
 * predictive-metric implementation. Needs the FULL {home, draw, away}
 * distribution `evaluateValue()` was given, not just the one selection it
 * evaluated — `BacktestDecisionPoint.prediction.probability1x2` already
 * carries that, so this reads straight from the original input rather
 * than trying to reconstruct it from the single-selection
 * `ValueAssessment`. Markets other than 1X2 contribute nothing here
 * (accuracy/log-loss/Brier score are 1X2-specific in this codebase);
 * `null` fields, never a forced/meaningless number, when there are zero
 * 1X2 points.
 */
export function computeBacktestPredictiveMetrics(points: readonly BacktestDecisionPoint[]): BacktestPredictiveMetrics {
  const predictions: Evaluation1x2Prediction[] = points
    .filter((point) => point.marketType === MarketType.MATCH_RESULT_1X2)
    .map((point) => ({ fixtureId: point.example.fixtureId, competitionId: point.example.competitionId, seasonId: point.example.seasonId, predicted: point.prediction.probability1x2, actual: point.example.target1x2 }));
  if (predictions.length === 0) return { sampleCount: 0, accuracy: null, logLoss: null, brierScore: null };
  return { sampleCount: predictions.length, accuracy: accuracy1x2(predictions), logLoss: logLoss1x2(predictions), brierScore: brierScore1x2(predictions) };
}
