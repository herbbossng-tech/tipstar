import type { MarketType } from "@sport-os/market-engine";
import { generateId, ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import { DecisionOutcome, DecisionReasonCode, type ValueAssessment } from "./decision.js";

/**
 * Ticket Engine (Section 07 §16-19). Produces a canonical, immutable
 * TICKET PROPOSAL — distinct from a DECISION (`DecisionOutcome.BET` is
 * an input here, not the ticket itself), distinct from an EXECUTED
 * wager (`AUTHORIZED`/`EXECUTING` are as far as this module goes — see
 * `@sport-os/agents`' Football Automation Agent for what happens after),
 * and distinct from `@sport-os/settlement-engine`'s `Ticket`/`Settlement`
 * (Section 08's post-execution/settlement concern — "settlement states
 * remain separate"). "PREDICTION ≠ TICKET PROPOSAL ≠ EXECUTED TICKET."
 */

export const TicketStatus = {
  DRAFT: "DRAFT",
  PROPOSED: "PROPOSED",
  VALIDATED: "VALIDATED",
  AUTHORIZED: "AUTHORIZED",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketType = { SINGLE: "SINGLE", ACCUMULATOR: "ACCUMULATOR" } as const;
export type TicketType = (typeof TicketType)[keyof typeof TicketType];

/** The only transitions `transitionTicketStatus` permits — mirrors the same explicit-state-machine pattern `@sport-os/agent-core`'s `InvocationStatus`/`AgentStatus` already use in this codebase. */
const ALLOWED_TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  [TicketStatus.DRAFT]: [TicketStatus.PROPOSED, TicketStatus.CANCELLED],
  [TicketStatus.PROPOSED]: [TicketStatus.VALIDATED, TicketStatus.REJECTED, TicketStatus.CANCELLED],
  [TicketStatus.VALIDATED]: [TicketStatus.AUTHORIZED, TicketStatus.REJECTED, TicketStatus.CANCELLED],
  [TicketStatus.AUTHORIZED]: [TicketStatus.EXECUTING, TicketStatus.CANCELLED],
  [TicketStatus.EXECUTING]: [TicketStatus.EXECUTED, TicketStatus.REJECTED],
  [TicketStatus.EXECUTED]: [],
  [TicketStatus.REJECTED]: [],
  [TicketStatus.CANCELLED]: [],
};

export function isValidTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TICKET_TRANSITIONS[from].includes(to);
}

export interface TicketLeg {
  readonly legId: UUID;
  readonly fixtureId: UUID;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly line: number | undefined;
  readonly probability: number;
  readonly odds: number;
  readonly fairOdds: number | undefined;
  readonly expectedValue: number | null;
  readonly edge: number | null;
  readonly modelVersion: string | undefined;
  readonly calculationVersion: string;
  readonly valueEvaluatedAt: ISODateString;
  /** Set by the caller from whatever upstream leakage detection (Section 04/05's `LeakageGuard`) reported for this leg's underlying data — never computed here; defaults to `false` only because most callers have nothing to report, never because this module assumes safety. */
  readonly leakageFlag: boolean;
}

/** Builds a `TicketLeg` from a real `ValueAssessment` (Value Engine output) — the ONLY sanctioned way a leg enters a ticket; nothing in this module accepts a raw probability/odds pair directly, so every leg is traceable back to a real value calculation. */
export function ticketLegFromValueAssessment(assessment: ValueAssessment, leakageFlag = false): TicketLeg {
  if (assessment.calibratedProbability === null || assessment.marketOdds === null) {
    throw new ValidationError({ message: "Cannot build a ticket leg from a ValueAssessment with no probability or odds.", code: "TICKET_LEG_MISSING_VALUE_DATA", context: { eventId: assessment.eventId, marketType: assessment.marketType, selection: assessment.selection } });
  }
  return {
    legId: generateId(),
    fixtureId: assessment.eventId,
    marketType: assessment.marketType,
    selection: assessment.selection,
    line: assessment.line,
    probability: assessment.calibratedProbability,
    odds: assessment.marketOdds,
    fairOdds: assessment.fairOdds,
    expectedValue: assessment.expectedValue,
    edge: assessment.edge,
    modelVersion: assessment.modelVersion,
    calculationVersion: assessment.calculationVersion,
    valueEvaluatedAt: assessment.evaluatedAt,
    leakageFlag,
  };
}

export const COMBINED_PROBABILITY_CALCULATION_VERSION = "combined-probability-v1-independence-assumption";

export interface CombinedProbability {
  readonly value: number;
  /** "independence_assumption" — Section 07 §18's product-of-probabilities method, EXPLICITLY marked as an assumption, never presented as exact. No joint/correlated method is implemented in this codebase; that is a documented, versioned future extension point, not silently approximated here. */
  readonly method: "independence_assumption";
  readonly calculationVersion: string;
}

/** Product of leg odds — the standard accumulator combined-odds convention. `undefined` if any leg has non-positive/non-finite odds (should be unreachable given legs are built from valid `ValueAssessment`s, but defended anyway). */
export function computeCombinedOdds(legs: readonly TicketLeg[]): number | undefined {
  if (legs.length === 0) return undefined;
  let product = 1;
  for (const leg of legs) {
    if (!(leg.odds > 0) || !Number.isFinite(leg.odds)) return undefined;
    product *= leg.odds;
  }
  return Math.round(product * 10000) / 10000;
}

/**
 * Product of leg probabilities under an EXPLICIT independence assumption
 * (§18: "If P(A and B) ≈ P(A) × P(B) is used: explicitly mark the
 * independence assumption, version the calculation, document
 * limitations... Never present an unsupported accumulator probability as
 * exact."). This is the ONLY combination method this codebase
 * implements — no correlated/joint method exists, so this function is
 * always tagged `method: "independence_assumption"`, never silently
 * presented as precise.
 */
export function computeCombinedProbability(legs: readonly TicketLeg[]): CombinedProbability | undefined {
  if (legs.length === 0) return undefined;
  let product = 1;
  for (const leg of legs) {
    if (!(leg.probability >= 0) || !(leg.probability <= 1)) return undefined;
    product *= leg.probability;
  }
  return { value: product, method: "independence_assumption", calculationVersion: COMBINED_PROBABILITY_CALCULATION_VERSION };
}

export interface TicketModelLineageEntry {
  readonly fixtureId: UUID;
  readonly modelVersion: string | undefined;
  readonly calculationVersion: string;
}

export interface TicketRecord {
  readonly ticketId: UUID;
  /** Increments on every state transition — never mutated in place; see `transitionTicketStatus`. */
  readonly version: number;
  readonly ticketType: TicketType;
  readonly legs: readonly TicketLeg[];
  /** Single: the one leg's own odds. Accumulator: the product — see `computeCombinedOdds`. */
  readonly combinedOdds: number | undefined;
  readonly combinedProbability: CombinedProbability | undefined;
  /** Undefined until `authorizeTicketStake` — "do not invent stake." */
  readonly stake: number | undefined;
  /** stake × combinedOdds — undefined until a stake exists. */
  readonly potentialReturn: number | undefined;
  readonly status: TicketStatus;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly createdBy: string;
  readonly modelLineage: readonly TicketModelLineageEntry[];
  readonly idempotencyKey: string | undefined;
  readonly rejectionReason: DecisionReasonCode | undefined;
}

export interface CreateTicketDraftParams {
  readonly legs: readonly TicketLeg[];
  readonly createdBy: string;
  readonly idempotencyKey?: string;
  readonly now?: () => ISODateString;
}

/** A 2-leg minimum for ACCUMULATOR is the standard convention (a single-leg "accumulator" is just a SINGLE) — documented here as the one place this rule is enforced. */
export function deriveTicketType(legCount: number): TicketType {
  return legCount <= 1 ? TicketType.SINGLE : TicketType.ACCUMULATOR;
}

/**
 * Builds a fresh `DRAFT` ticket — the only place a `TicketRecord` is
 * constructed from scratch (`transitionTicketStatus` is the only other
 * way one ever changes, and it never mutates, only produces a new
 * version). "A 5-leg accumulator is ONE TICKET with FIVE LEGS" — this
 * function always produces exactly one `TicketRecord`, however many
 * legs it holds; nothing in this module ever flattens legs into
 * separate tickets.
 */
export function createTicketDraft(params: CreateTicketDraftParams): TicketRecord {
  if (params.legs.length === 0) {
    throw new ValidationError({ message: "A ticket must have at least one leg.", code: "TICKET_NO_LEGS" });
  }
  const now = (params.now ?? (() => new Date().toISOString()))();
  const modelLineage: TicketModelLineageEntry[] = params.legs.map((leg) => ({ fixtureId: leg.fixtureId, modelVersion: leg.modelVersion, calculationVersion: leg.calculationVersion }));
  return {
    ticketId: generateId(),
    version: 1,
    ticketType: deriveTicketType(params.legs.length),
    legs: params.legs,
    combinedOdds: computeCombinedOdds(params.legs),
    combinedProbability: computeCombinedProbability(params.legs),
    stake: undefined,
    potentialReturn: undefined,
    status: TicketStatus.DRAFT,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
    modelLineage,
    idempotencyKey: params.idempotencyKey,
    rejectionReason: undefined,
  };
}

/**
 * The ONLY way a `TicketRecord`'s status changes (§16, §34: "do not
 * overwrite historical ticket versions... if a ticket is revised: create
 * a new version/proposal or explicit state transition"). Returns a
 * BRAND NEW object with `version` incremented; the caller (a real
 * repository — see `db/repositories.ts`) is responsible for persisting
 * this as a NEW row/version, never an UPDATE that destroys the prior
 * one. Throws on any transition not in the documented state machine.
 */
export function transitionTicketStatus(ticket: TicketRecord, next: TicketStatus, now: ISODateString, patch: { readonly rejectionReason?: DecisionReasonCode; readonly stake?: number } = {}): TicketRecord {
  if (!isValidTicketTransition(ticket.status, next)) {
    throw new ValidationError({ message: `Invalid ticket transition: ${ticket.status} -> ${next}.`, code: "TICKET_INVALID_TRANSITION", context: { ticketId: ticket.ticketId, from: ticket.status, to: next } });
  }
  const stake = patch.stake ?? ticket.stake;
  const potentialReturn = stake !== undefined && ticket.combinedOdds !== undefined ? Math.round(stake * ticket.combinedOdds * 100) / 100 : undefined;
  return {
    ...ticket,
    version: ticket.version + 1,
    status: next,
    updatedAt: now,
    stake,
    potentialReturn,
    rejectionReason: next === TicketStatus.REJECTED ? (patch.rejectionReason ?? ticket.rejectionReason) : ticket.rejectionReason,
  };
}

/** VALIDATED -> AUTHORIZED with a real, caller-specified stake — the ONLY place a `TicketRecord` ever gets a non-undefined `stake`. Never called with an invented value; the stake must come from an actual authorization decision upstream (out of this module's scope). */
export function authorizeTicketStake(ticket: TicketRecord, stake: number, now: ISODateString): TicketRecord {
  if (stake <= 0) {
    throw new ValidationError({ message: "Stake must be a positive number.", code: "TICKET_INVALID_STAKE", context: { stake } });
  }
  return transitionTicketStatus(ticket, TicketStatus.AUTHORIZED, now, { stake });
}

// ============================================================
// Validation (§19)
// ============================================================

export const TicketValidationFailureCode = {
  NO_LEGS: "NO_LEGS",
  INVALID_PROBABILITY: "INVALID_PROBABILITY",
  INVALID_ODDS: "INVALID_ODDS",
  DUPLICATE_LEG: "DUPLICATE_LEG",
  LEAKAGE_FLAGGED: "LEAKAGE_FLAGGED",
  TOO_MANY_LEGS: "TOO_MANY_LEGS",
  MISSING_VALUE_CALCULATION: "MISSING_VALUE_CALCULATION",
  DECISION_NOT_BET: "DECISION_NOT_BET",
} as const;
export type TicketValidationFailureCode = (typeof TicketValidationFailureCode)[keyof typeof TicketValidationFailureCode];

export interface TicketConstraints {
  readonly maxAccumulatorLegs: number;
}

export type TicketValidationResult = { readonly valid: true } | { readonly valid: false; readonly failures: readonly TicketValidationFailureCode[] };

/**
 * Deterministic (§19): the same ticket + constraints always produces the
 * same result. Every one of §19's checks that is representable from the
 * ticket's own data alone (fixture/market/selection existence is
 * verified upstream, when the `ValueAssessment` each leg came from was
 * computed — see `evaluateValue`, which already returns
 * `MARKET_UNSUPPORTED`/`INSUFFICIENT_DATA` for a nonexistent fixture or
 * market before a leg can even be built).
 */
export function validateTicket(ticket: TicketRecord, constraints: TicketConstraints, decisions: readonly ValueAssessment[]): TicketValidationResult {
  const failures: TicketValidationFailureCode[] = [];

  if (ticket.legs.length === 0) failures.push(TicketValidationFailureCode.NO_LEGS);
  if (ticket.ticketType === TicketType.ACCUMULATOR && ticket.legs.length > constraints.maxAccumulatorLegs) failures.push(TicketValidationFailureCode.TOO_MANY_LEGS);

  const seen = new Set<string>();
  for (const leg of ticket.legs) {
    const key = `${leg.fixtureId}:${leg.marketType}:${leg.selection}:${leg.line ?? ""}`;
    if (seen.has(key)) failures.push(TicketValidationFailureCode.DUPLICATE_LEG);
    seen.add(key);

    if (!(leg.probability >= 0) || !(leg.probability <= 1)) failures.push(TicketValidationFailureCode.INVALID_PROBABILITY);
    if (!(leg.odds > 1) || !Number.isFinite(leg.odds)) failures.push(TicketValidationFailureCode.INVALID_ODDS);
    if (leg.leakageFlag) failures.push(TicketValidationFailureCode.LEAKAGE_FLAGGED);
    if (leg.expectedValue === null || leg.edge === null) failures.push(TicketValidationFailureCode.MISSING_VALUE_CALCULATION);

    const decision = decisions.find((d) => d.eventId === leg.fixtureId && d.marketType === leg.marketType && d.selection === leg.selection);
    if (!decision || decision.decision !== DecisionOutcome.BET) failures.push(TicketValidationFailureCode.DECISION_NOT_BET);
  }

  const uniqueFailures = [...new Set(failures)];
  return uniqueFailures.length === 0 ? { valid: true } : { valid: false, failures: uniqueFailures };
}
