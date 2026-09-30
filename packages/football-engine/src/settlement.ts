import { MarketType } from "@sport-os/market-engine";
import { computeNetPnl, computeRoi, PayoutSource, SettlementStatus, type LedgerMode, type Money, type PerformanceRecordInput } from "@sport-os/settlement-engine";
import { generateId, type ISODateString, type UUID } from "@sport-os/shared";
import { TicketStatus, type TicketLeg, type TicketRecord } from "./ticket-engine.js";

/**
 * Football Settlement Engine (Section 08 §10-16). Grades a real
 * `TicketRecord`'s legs against real football results, then aggregates
 * per §13's accumulator policy — "a 5-leg accumulator is ONE TICKET,
 * FIVE LEGS." Every function here is pure: no I/O, no repository access.
 * The caller (an agent or orchestration layer) is responsible for
 * resolving the real, point-in-time-correct `FootballResultSnapshot` per
 * fixture (via `@sport-os/football-engine`'s own `MatchResultsRepository.
 * getAsOf()`/`getLatest()` — never re-implemented here) and the real
 * execution accounting (stake/payout — from Section 07's
 * `execution_requests`/`execution_results`, never invented here either).
 *
 * "ANALYTICAL OUTCOME ≠ FINANCIAL OUTCOME": `settleTicket()` always
 * grades the legs against the real result when one exists, whether or
 * not `execution` is supplied — a ticket can be settled WON/LOST purely
 * analytically, with `actualStake`/`actualPayout`/`netPnl`/`roi` all
 * `null` (§42).
 */

/** The minimal real result data a market grading rule needs — never the full `MatchResult` row (id/fixtureId/correction metadata are the caller's lineage concern, not this module's). `resultVersionId` is threaded through purely for audit — see `LegSettlement.resultVersionId`. */
export interface FootballResultSnapshot {
  readonly resultVersionId: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly halftimeHomeGoals: number | undefined;
  readonly halftimeAwayGoals: number | undefined;
}

export interface MarketSettlementOutcome {
  readonly status: SettlementStatus;
  readonly reason: string;
}

function threeWayOutcome(homeGoals: number, awayGoals: number): "HOME" | "DRAW" | "AWAY" {
  return homeGoals > awayGoals ? "HOME" : awayGoals > homeGoals ? "AWAY" : "DRAW";
}

function grade1x2(homeGoals: number, awayGoals: number, selection: string): MarketSettlementOutcome {
  const actual = threeWayOutcome(homeGoals, awayGoals);
  return selection === actual
    ? { status: SettlementStatus.WON, reason: `Score ${homeGoals}-${awayGoals} resolved to ${actual}.` }
    : { status: SettlementStatus.LOST, reason: `Score ${homeGoals}-${awayGoals} resolved to ${actual}, not ${selection}.` };
}

const DOUBLE_CHANCE_COVERAGE: Readonly<Record<string, readonly string[]>> = { "1X": ["HOME", "DRAW"], X2: ["DRAW", "AWAY"], "12": ["HOME", "AWAY"] };

function gradeDoubleChance(homeGoals: number, awayGoals: number, selection: string): MarketSettlementOutcome {
  const actual = threeWayOutcome(homeGoals, awayGoals);
  const covered = DOUBLE_CHANCE_COVERAGE[selection];
  if (!covered) return { status: SettlementStatus.PENDING, reason: `Unrecognized Double Chance selection "${selection}".` };
  return covered.includes(actual)
    ? { status: SettlementStatus.WON, reason: `Score ${homeGoals}-${awayGoals} resolved to ${actual}, covered by ${selection}.` }
    : { status: SettlementStatus.LOST, reason: `Score ${homeGoals}-${awayGoals} resolved to ${actual}, not covered by ${selection}.` };
}

function gradeBtts(homeGoals: number, awayGoals: number, selection: string): MarketSettlementOutcome {
  const bothScored = homeGoals > 0 && awayGoals > 0;
  const actual = bothScored ? "YES" : "NO";
  return selection === actual
    ? { status: SettlementStatus.WON, reason: `Score ${homeGoals}-${awayGoals}: both teams scored = ${bothScored}.` }
    : { status: SettlementStatus.LOST, reason: `Score ${homeGoals}-${awayGoals}: both teams scored = ${bothScored}, not ${selection}.` };
}

function gradeOverUnder(homeGoals: number, awayGoals: number, selection: string, line: number | undefined): MarketSettlementOutcome {
  if (line === undefined) return { status: SettlementStatus.PENDING, reason: "Over/Under requires a line." };
  const total = homeGoals + awayGoals;
  if (total === line) return { status: SettlementStatus.PUSH, reason: `Total goals ${total} exactly equals the line ${line} — stake returned.` };
  const actual = total > line ? "OVER" : "UNDER";
  return selection === actual
    ? { status: SettlementStatus.WON, reason: `Total goals ${total} vs line ${line} resolved to ${actual}.` }
    : { status: SettlementStatus.LOST, reason: `Total goals ${total} vs line ${line} resolved to ${actual}, not ${selection}.` };
}

function gradeCorrectScore(homeGoals: number, awayGoals: number, selection: string): MarketSettlementOutcome {
  const actual = `${homeGoals}-${awayGoals}`;
  return selection === actual
    ? { status: SettlementStatus.WON, reason: `Final score ${actual} matches the selection.` }
    : { status: SettlementStatus.LOST, reason: `Final score ${actual} does not match selection ${selection}.` };
}

/** Canonical 3-way European Handicap: the line is added to the HOME side's goals before the usual 1X2 comparison — always resolves to HOME/DRAW/AWAY, never a push (§11's "canonical three-way handicap settlement"). */
function gradeEuropeanHandicap(homeGoals: number, awayGoals: number, selection: string, line: number | undefined): MarketSettlementOutcome {
  if (line === undefined) return { status: SettlementStatus.PENDING, reason: "European Handicap requires a line." };
  const adjustedHomeGoals = homeGoals + line;
  const actual = adjustedHomeGoals > awayGoals ? "HOME" : awayGoals > adjustedHomeGoals ? "AWAY" : "DRAW";
  return selection === actual
    ? { status: SettlementStatus.WON, reason: `Handicap-adjusted score ${adjustedHomeGoals}-${awayGoals} (line ${line}) resolved to ${actual}.` }
    : { status: SettlementStatus.LOST, reason: `Handicap-adjusted score ${adjustedHomeGoals}-${awayGoals} (line ${line}) resolved to ${actual}, not ${selection}.` };
}

/** Only whole/half Asian Handicap lines are supported (§11 — "implement only supported lines and explicit push/void behavior"); a half line can never push by construction. Quarter lines require split-stake settlement, which this codebase does not implement — graded PENDING rather than guessed. */
function isSupportedAsianLine(line: number): boolean {
  return Number.isFinite(line) && Math.abs(line * 2 - Math.round(line * 2)) < 1e-9;
}

function gradeAsianHandicap(homeGoals: number, awayGoals: number, selection: string, line: number | undefined): MarketSettlementOutcome {
  if (line === undefined) return { status: SettlementStatus.PENDING, reason: "Asian Handicap requires a line." };
  if (!isSupportedAsianLine(line)) return { status: SettlementStatus.PENDING, reason: `Asian Handicap quarter-line ${line} requires split-stake settlement, which is not implemented here.` };
  if (selection !== "HOME" && selection !== "AWAY") return { status: SettlementStatus.PENDING, reason: `Unrecognized Asian Handicap selection "${selection}".` };
  const margin = selection === "HOME" ? homeGoals - awayGoals + line : awayGoals - homeGoals + line;
  if (margin === 0) return { status: SettlementStatus.PUSH, reason: `Handicap-adjusted margin is exactly 0 for line ${line} — stake returned.` };
  return margin > 0
    ? { status: SettlementStatus.WON, reason: `Handicap-adjusted margin ${margin} favors ${selection} (line ${line}).` }
    : { status: SettlementStatus.LOST, reason: `Handicap-adjusted margin ${margin} against ${selection} (line ${line}).` };
}

function gradeFirstHalf(result: FootballResultSnapshot, selection: string): MarketSettlementOutcome {
  if (result.halftimeHomeGoals === undefined || result.halftimeAwayGoals === undefined) {
    return { status: SettlementStatus.PENDING, reason: "Halftime score is not yet available." };
  }
  return grade1x2(result.halftimeHomeGoals, result.halftimeAwayGoals, selection);
}

function gradeSecondHalf(result: FootballResultSnapshot, selection: string): MarketSettlementOutcome {
  if (result.halftimeHomeGoals === undefined || result.halftimeAwayGoals === undefined) {
    return { status: SettlementStatus.PENDING, reason: "Halftime score is not yet available — second-half goals cannot be derived." };
  }
  return grade1x2(result.homeGoals - result.halftimeHomeGoals, result.awayGoals - result.halftimeAwayGoals, selection);
}

/**
 * Grades exactly ONE market selection against a real result — deterministic,
 * pure. `result: undefined` (no result known yet) always resolves to
 * PENDING, never guessed. Team Totals/Corners/Cards are explicitly
 * PENDING for every call — this codebase's `FootballResultSnapshot`
 * carries no canonical data for them yet (§10 — "if required result data
 * is unavailable: PENDING. Do not guess.").
 */
export function settleMarket(marketType: MarketType, selection: string, line: number | undefined, result: FootballResultSnapshot | undefined): MarketSettlementOutcome {
  if (!result) return { status: SettlementStatus.PENDING, reason: "No result is available yet for this fixture." };
  switch (marketType) {
    case MarketType.MATCH_RESULT_1X2:
      return grade1x2(result.homeGoals, result.awayGoals, selection);
    case MarketType.DOUBLE_CHANCE:
      return gradeDoubleChance(result.homeGoals, result.awayGoals, selection);
    case MarketType.BOTH_TEAMS_TO_SCORE:
      return gradeBtts(result.homeGoals, result.awayGoals, selection);
    case MarketType.OVER_UNDER:
      return gradeOverUnder(result.homeGoals, result.awayGoals, selection, line);
    case MarketType.CORRECT_SCORE:
      return gradeCorrectScore(result.homeGoals, result.awayGoals, selection);
    case MarketType.EUROPEAN_HANDICAP:
      return gradeEuropeanHandicap(result.homeGoals, result.awayGoals, selection, line);
    case MarketType.ASIAN_HANDICAP:
      return gradeAsianHandicap(result.homeGoals, result.awayGoals, selection, line);
    case MarketType.FIRST_HALF:
      return gradeFirstHalf(result, selection);
    case MarketType.SECOND_HALF:
      return gradeSecondHalf(result, selection);
    case MarketType.TEAM_TOTALS:
    case MarketType.CORNERS:
    case MarketType.CARDS:
      return { status: SettlementStatus.PENDING, reason: `${marketType} settlement requires result data this codebase does not model yet.` };
    default:
      return { status: SettlementStatus.PENDING, reason: `Unrecognized market type "${marketType}".` };
  }
}

export interface LegSettlement {
  readonly legId: UUID;
  readonly fixtureId: UUID;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly line: number | undefined;
  readonly odds: number;
  readonly status: SettlementStatus;
  readonly resultVersionId: string | undefined;
  readonly reason: string;
}

export function settleLeg(leg: TicketLeg, result: FootballResultSnapshot | undefined): LegSettlement {
  const outcome = settleMarket(leg.marketType, leg.selection, leg.line, result);
  return { legId: leg.legId, fixtureId: leg.fixtureId, marketType: leg.marketType, selection: leg.selection, line: leg.line, odds: leg.odds, status: outcome.status, resultVersionId: result?.resultVersionId, reason: outcome.reason };
}

export const FOOTBALL_SETTLEMENT_POLICY_VERSION = "football-settlement-v1";

export interface TicketLegAggregation {
  readonly status: SettlementStatus;
  /** Product of WON legs' odds (VOID/PUSH legs contribute 1.0, per §13's "neutral multiplier"). `undefined` when the ticket did not resolve to WON (there is nothing meaningful to multiply). */
  readonly combinedMultiplier: number | undefined;
}

/**
 * Accumulator settlement policy (§13/§14, versioned as
 * `FOOTBALL_SETTLEMENT_POLICY_VERSION`).
 *
 * A SINGLE (exactly one leg) always takes that leg's own status directly
 * — WON/LOST/VOID/PUSH/PENDING are all real, distinct states for a
 * single bet, and none of them collapse into another (a single that
 * pushes is PUSH, never re-labeled VOID).
 *
 * A genuine multi-leg ACCUMULATOR aggregates: any LOST leg -> ticket
 * LOST (checked first — a losing leg is conclusive regardless of any
 * other leg's status, including a still-PENDING one). Otherwise any
 * PENDING leg -> ticket PENDING. Otherwise, if every leg is VOID/PUSH ->
 * ticket VOID (§13 — no leg actually won anything, so there is nothing
 * to distinguish a "push" from a "void" at the ticket level; the whole
 * stake is returned either way — a documented, versioned convention,
 * never a silently-applied bookmaker-specific rule). Otherwise (every
 * leg is WON, VOID, or PUSH, with at least one real WON leg) -> ticket
 * WON, with VOID/PUSH legs contributing a neutral 1.0 multiplier to the
 * combined odds.
 */
export function settleTicketLegs(legSettlements: readonly LegSettlement[]): TicketLegAggregation {
  if (legSettlements.length === 0) return { status: SettlementStatus.PENDING, combinedMultiplier: undefined };
  if (legSettlements.length === 1) {
    const only = legSettlements[0]!;
    if (only.status === SettlementStatus.WON) return { status: SettlementStatus.WON, combinedMultiplier: only.odds };
    if (only.status === SettlementStatus.VOID || only.status === SettlementStatus.PUSH) return { status: only.status, combinedMultiplier: 1 };
    return { status: only.status, combinedMultiplier: undefined };
  }
  if (legSettlements.some((leg) => leg.status === SettlementStatus.LOST)) return { status: SettlementStatus.LOST, combinedMultiplier: undefined };
  if (legSettlements.some((leg) => leg.status === SettlementStatus.PENDING)) return { status: SettlementStatus.PENDING, combinedMultiplier: undefined };
  const allVoidOrPush = legSettlements.every((leg) => leg.status === SettlementStatus.VOID || leg.status === SettlementStatus.PUSH);
  if (allVoidOrPush) return { status: SettlementStatus.VOID, combinedMultiplier: 1 };
  const combinedMultiplier = legSettlements.reduce((product, leg) => product * (leg.status === SettlementStatus.WON ? leg.odds : 1), 1);
  return { status: SettlementStatus.WON, combinedMultiplier };
}

/** Real financial accounting for one ticket's execution — supplied by the caller from Section 07's real `execution_requests`/`execution_results`, never invented here. `undefined` means this ticket was never executed at all (§15/§42). */
export interface FootballExecutionAccounting {
  readonly stake: Money;
  /** `undefined` when no payout is known yet (e.g. PENDING settlement, or a provider payout hasn't arrived). */
  readonly payout: Money | undefined;
  readonly payoutSource: PayoutSource;
}

export interface SettleTicketParams {
  readonly ticket: TicketRecord;
  /** Real, point-in-time-resolved results, keyed by fixtureId — resolved by the caller via `MatchResultsRepository.getAsOf()`/`getLatest()`, never re-resolved here. */
  readonly results: ReadonlyMap<UUID, FootballResultSnapshot>;
  readonly execution: FootballExecutionAccounting | undefined;
  readonly ledgerMode: LedgerMode;
  readonly source: string;
  readonly correlationId?: string;
  readonly now: ISODateString;
}

export interface TicketSettlement {
  readonly settlementId: UUID;
  readonly ticketId: UUID;
  readonly ticketVersion: number;
  readonly status: SettlementStatus;
  readonly legs: readonly LegSettlement[];
  readonly settlementPolicyVersion: string;
  readonly ledgerMode: LedgerMode;
  /** `null` unless this ticket was actually executed (§15) — never inferred from a proposal, a risk limit, or a default configuration. */
  readonly actualStake: Money | null;
  /** `null` unless a real execution provider supplied a payout (§12/§16) — a CALCULATED_RETURN is never written here. */
  readonly actualPayout: Money | null;
  readonly payoutSource: PayoutSource | undefined;
  /** A labeled estimate (stake × combined odds, or stake returned for VOID/PUSH, or 0 for LOST) — only ever computed when a real actual stake exists; never presented as ACTUAL_RETURN (§14/§16). */
  readonly calculatedReturn: Money | null;
  /** Derived ONLY from `actualPayout` — never from `calculatedReturn` (§51: actual P&L only from confirmed execution financial records). */
  readonly netPnl: Money | null;
  readonly roi: number | null;
  readonly settledAt: ISODateString | null;
  readonly source: string;
  readonly correlationId: string | undefined;
}

function buildTicketSettlement(params: SettleTicketParams, status: SettlementStatus, legs: readonly LegSettlement[], combinedMultiplier: number | undefined): TicketSettlement {
  const isResolved = status === SettlementStatus.WON || status === SettlementStatus.LOST || status === SettlementStatus.VOID || status === SettlementStatus.PUSH || status === SettlementStatus.CANCELLED;
  const settledAt = isResolved ? params.now : null;

  const actualStake = params.execution?.stake ?? null;
  const actualPayout = params.execution?.payoutSource === PayoutSource.PROVIDER && params.execution.payout !== undefined ? params.execution.payout : null;

  let calculatedReturn: Money | null = null;
  if (actualStake !== null && isResolved) {
    if (status === SettlementStatus.LOST) {
      calculatedReturn = { amount: 0, currency: actualStake.currency };
    } else if (status === SettlementStatus.VOID || status === SettlementStatus.PUSH || status === SettlementStatus.CANCELLED) {
      calculatedReturn = actualStake;
    } else if (status === SettlementStatus.WON && combinedMultiplier !== undefined) {
      calculatedReturn = { amount: Math.round(actualStake.amount * combinedMultiplier * 100) / 100, currency: actualStake.currency };
    }
  }

  const netPnl = computeNetPnl(actualStake, actualPayout);
  const roi = computeRoi(netPnl, actualStake);
  const payoutSource = actualPayout !== null ? PayoutSource.PROVIDER : calculatedReturn !== null ? PayoutSource.CALCULATED : undefined;

  return {
    settlementId: generateId(),
    ticketId: params.ticket.ticketId,
    ticketVersion: params.ticket.version,
    status,
    legs,
    settlementPolicyVersion: FOOTBALL_SETTLEMENT_POLICY_VERSION,
    ledgerMode: params.ledgerMode,
    actualStake,
    actualPayout,
    payoutSource,
    calculatedReturn,
    netPnl,
    roi,
    settledAt,
    source: params.source,
    correlationId: params.correlationId,
  };
}

/**
 * Settles one real `TicketRecord` (§C/§D/§E). A `CANCELLED` ticket
 * resolves directly to `SettlementStatus.CANCELLED` without ever grading
 * its legs (there is nothing to grade — the ticket was withdrawn).
 * Everything else (including `REJECTED`, still `DRAFT`, etc.) is graded
 * for real against `params.results` — settling a ticket's analytical
 * outcome never requires it to have been executed (§42).
 */
export function settleTicket(params: SettleTicketParams): TicketSettlement {
  if (params.ticket.status === TicketStatus.CANCELLED) {
    return buildTicketSettlement(params, SettlementStatus.CANCELLED, [], undefined);
  }
  const legSettlements = params.ticket.legs.map((leg) => settleLeg(leg, params.results.get(leg.fixtureId)));
  const aggregation = settleTicketLegs(legSettlements);
  return buildTicketSettlement(params, aggregation.status, legSettlements, aggregation.combinedMultiplier);
}

/**
 * The one adapter from a real `TicketSettlement` into the sport-agnostic
 * `PerformanceRecordInput` shape `@sport-os/settlement-engine`'s
 * `buildPerformanceLedgerEntry()` aggregates — never a second
 * aggregation algorithm here. `legCount` is `settlement.legs.length`
 * (§24: one entry per TICKET regardless of leg count); `expectedEv` is
 * supplied by the caller when it has the underlying decisions'
 * expected-value figures available (this module never computes EV
 * itself — see `@sport-os/football-engine/decision.ts`).
 */
export function toPerformanceRecordInput(settlement: TicketSettlement, expectedEv?: number): PerformanceRecordInput {
  return {
    status: settlement.status,
    ledgerMode: settlement.ledgerMode,
    legCount: settlement.legs.length,
    executed: settlement.actualStake !== null,
    actualStake: settlement.actualStake,
    actualPayout: settlement.actualPayout,
    expectedEv,
    settledAt: settlement.settledAt,
  };
}
