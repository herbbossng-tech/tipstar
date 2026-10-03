/**
 * Mini App view-model types for the Section 09 read endpoints
 * (`football-fixtures`, `football-fixture-detail`, `tickets`,
 * `ticket-detail`, `performance-summary`). Defined locally rather than
 * imported from `@sport-os/football-engine`/`@sport-os/settlement-engine`
 * — those packages are server-side TypeScript with no browser-bundling
 * guarantee, mirroring the precedent already set by `auth/types.ts` for
 * `@sport-os/telegram`. Enum string VALUES are kept byte-identical to
 * their backend source (linked in each comment) — never a "subtly
 * incompatible" duplicate (Section 09 §45).
 */

/** Mirrors `@sport-os/settlement-engine`'s `Money` (Section 08) — an amount is never rendered without its currency, and a `null` Money means "not known/not applicable", never zero. */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

/** Mirrors `public.match_status` (supabase/migrations/20260929130000_football_enums.sql). */
export type MatchStatus = "scheduled" | "timed" | "live" | "halftime" | "finished" | "postponed" | "cancelled" | "abandoned" | "suspended" | "unknown";

/** Mirrors `@sport-os/football-engine`'s `DecisionOutcome` (Section 07). */
export type DecisionOutcome = "BET" | "NO_EDGE" | "WAIT" | "NO_TRADE" | "INSUFFICIENT_DATA" | "MARKET_UNSUPPORTED" | "RISK_REJECTED";

/** Mirrors `@sport-os/football-engine`'s `TicketStatus` (Section 07). */
export type TicketStatus = "DRAFT" | "PROPOSED" | "VALIDATED" | "AUTHORIZED" | "EXECUTING" | "EXECUTED" | "REJECTED" | "CANCELLED";

export type TicketType = "SINGLE" | "ACCUMULATOR";

/** Mirrors `@sport-os/agents`' `ExecutionResultStatus` (Section 07), plus the Mini-App-only `NOT_EXECUTED`/`REQUESTED` states the backend never returns as a stored enum value but this UI must still represent honestly — see `tickets`/`ticket-detail` edge functions' own comments. */
export type ExecutionStatus = "NOT_EXECUTED" | "REQUESTED" | "AUTHORIZED" | "SUBMITTED" | "ACCEPTED" | "EXECUTED" | "REJECTED" | "FAILED" | "UNKNOWN" | "NOT_AVAILABLE" | "MANUAL_REQUIRED";

export type ExecutionMode = "manual" | "assisted" | "automatic";

/** Mirrors `@sport-os/settlement-engine`'s `SettlementStatus` (Section 08), plus the Mini-App-only `NOT_SETTLED` state (no settlement row exists yet — distinct from the real `PENDING` settlement state). */
export type SettlementStatusView = "NOT_SETTLED" | "PENDING" | "WON" | "LOST" | "VOID" | "PUSH" | "CANCELLED";

export type LedgerMode = "LIVE" | "PAPER";

export type PayoutSource = "PROVIDER" | "CALCULATED";

// ---- Football ----

export interface CompetitionRef {
  readonly id: string;
  readonly name: string;
  readonly country: string | null;
}

export interface TeamRef {
  readonly id: string;
  readonly name: string;
}

export interface FixtureSummary {
  readonly fixtureId: string;
  readonly competition: CompetitionRef | null;
  readonly homeTeam: TeamRef | null;
  readonly awayTeam: TeamRef | null;
  readonly scheduledKickoffAt: string;
  readonly actualKickoffAt: string | null;
  readonly status: MatchStatus;
  readonly hasMarketData: boolean;
  readonly hasIntelligence: boolean;
}

export interface FootballFixturesResponse {
  readonly date: string;
  readonly fixtures: readonly FixtureSummary[];
}

export interface FinalizedDecisionView {
  readonly outcome: DecisionOutcome;
  readonly reasons: readonly string[];
  readonly qualifies: boolean;
  readonly decidedAt: string;
}

export interface MarketIntelligenceView {
  readonly marketType: string;
  readonly selection: string;
  readonly line: number | null;
  readonly modelProbability: number | null;
  readonly marketOdds: number | null;
  readonly fairOdds: number | null;
  readonly edge: number | null;
  readonly expectedValue: number | null;
  readonly dataQuality: string | null;
  readonly oddsTimestamp: string | null;
  readonly modelVersion: string | null;
  readonly calculationVersion: string;
  readonly valueEngineDecision: DecisionOutcome;
  readonly valueEngineReasons: readonly string[];
  readonly qualifies: boolean;
  readonly evaluatedAt: string;
  readonly finalizedDecision: FinalizedDecisionView | null;
}

export interface MarketObservationView {
  readonly marketType: string;
  readonly selection: string;
  readonly line: number | null;
  readonly odds: number | null;
  readonly oddsTimestamp: string;
  readonly status: "open" | "suspended" | "cancelled";
}

export interface MatchResultView {
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly halftimeHomeGoals: number | null;
  readonly halftimeAwayGoals: number | null;
  readonly resultRecordedAt: string;
}

export interface FixtureDetailResponse {
  readonly fixture: {
    readonly fixtureId: string;
    readonly competition: CompetitionRef | null;
    readonly homeTeam: TeamRef | null;
    readonly awayTeam: TeamRef | null;
    readonly scheduledKickoffAt: string;
    readonly actualKickoffAt: string | null;
    readonly status: MatchStatus;
  };
  readonly result: MatchResultView | null;
  readonly markets: readonly MarketIntelligenceView[];
  readonly marketObservations: readonly MarketObservationView[];
}

// ---- Tickets ----

export interface TicketSummary {
  readonly ticketId: string;
  readonly ticketType: TicketType;
  readonly legCount: number;
  readonly status: TicketStatus;
  readonly stake: number | null;
  readonly combinedOdds: number | null;
  readonly createdAt: string;
  readonly executionStatus: ExecutionStatus;
  readonly settlementStatus: SettlementStatusView;
  readonly settlementWasRevised: boolean;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly netPnl: Money | null;
  readonly roi: number | null;
}

export interface TicketsResponse {
  readonly tickets: readonly TicketSummary[];
}

export interface TicketLegView {
  readonly id: string;
  readonly fixture_id: string;
  readonly market_type: string;
  readonly selection: string;
  readonly line: number | null;
  readonly probability: number;
  readonly odds: number;
  readonly fair_odds: number | null;
  readonly expected_value: number | null;
  readonly edge: number | null;
  readonly model_version: string | null;
  readonly calculation_version: string;
  readonly value_evaluated_at: string;
  readonly leakage_flag: boolean;
}

export interface RiskEvaluationView {
  readonly risk_code: string;
  readonly reasons: readonly string[];
  readonly approved: boolean;
  readonly reason: string;
  readonly proposed_stake: number | null;
  readonly projected_daily_stake: number | null;
  readonly projected_daily_ticket_count: number | null;
  readonly policy_version: string;
  readonly evaluated_at: string;
}

export interface ExecutionResultView {
  readonly status: ExecutionStatus;
  readonly external_reference: string | null;
  readonly stake: number | null;
  readonly executed_at: string | null;
  readonly recorded_at: string;
}

export interface ExecutionRequestView {
  readonly requestId: string;
  readonly executionMode: ExecutionMode;
  readonly stake: number;
  readonly marketType: string | null;
  readonly selection: string | null;
  readonly odds: number | null;
  readonly userConfirmed: boolean;
  readonly gateAuthorized: boolean;
  readonly gateFailedCheck: string | null;
  readonly gateDenialCode: string | null;
  readonly gateDenialReason: string | null;
  readonly requestedAt: string;
  readonly results: readonly ExecutionResultView[];
}

export interface SettlementRevisionView {
  readonly revisionId: string;
  readonly previousStatus: SettlementStatusView;
  readonly newStatus: SettlementStatusView;
  readonly previousPayout: Money | null;
  readonly newPayout: Money | null;
  readonly reason: string;
  readonly source: string;
  readonly createdAt: string;
}

export interface SettlementLegView {
  readonly fixture_id: string;
  readonly market_type: string;
  readonly selection: string;
  readonly line: number | null;
  readonly odds: number;
  readonly status: SettlementStatusView;
  readonly result_version_id: string | null;
  readonly reason: string;
}

export interface TicketSettlementView {
  readonly settlementId: string;
  readonly originalStatus: SettlementStatusView;
  readonly effectiveStatus: SettlementStatusView;
  readonly settlementPolicyVersion: string;
  readonly ledgerMode: LedgerMode;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly payoutSource: PayoutSource | null;
  readonly calculatedReturn: Money | null;
  readonly netPnl: Money | null;
  readonly roi: number | null;
  readonly settledAt: string | null;
  readonly legs: readonly SettlementLegView[];
  readonly revisions: readonly SettlementRevisionView[];
}

export interface TicketDetailResponse {
  readonly ticket: {
    readonly ticketId: string;
    readonly ticketType: TicketType;
    readonly version: number;
    readonly status: TicketStatus;
    readonly stake: number | null;
    readonly potentialReturn: number | null;
    readonly combinedOdds: number | null;
    readonly combinedProbability: number | null;
    readonly combinedProbabilityMethod: string | null;
    readonly combinedProbabilityCalculationVersion: string | null;
    readonly rejectionReason: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly legs: readonly TicketLegView[];
  readonly decisions: readonly FinalizedDecisionView[];
  readonly risk: readonly RiskEvaluationView[];
  readonly execution: readonly ExecutionRequestView[];
  readonly settlement: TicketSettlementView | null;
}

// ---- Performance ----

export interface PerformanceLedgerEntryView {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly ledgerMode: LedgerMode;
  readonly sport: string;
  readonly league: string | null;
  readonly market: string | null;
  readonly modelVersion: string | null;
  readonly decisionPolicyVersion: string | null;
  readonly ticketType: string | null;
  readonly ticketCount: number;
  readonly legCount: number;
  readonly executedTicketCount: number;
  readonly settledTicketCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly pushes: number;
  readonly pending: number;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly actualPnl: Money | null;
  readonly roi: number | null;
  readonly expectedEv: number | null;
  readonly maxDrawdown: number | null;
  readonly longestLosingStreak: number | null;
  readonly sampleSize: number;
}

export interface PerformanceSummaryResponse {
  readonly ledgerMode: LedgerMode;
  readonly entries: readonly PerformanceLedgerEntryView[];
}

export interface PerformanceFilters {
  readonly ledgerMode?: LedgerMode;
  readonly sport?: string;
  readonly league?: string;
  readonly market?: string;
  readonly modelVersion?: string;
  readonly decisionPolicyVersion?: string;
  readonly ticketType?: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
}
