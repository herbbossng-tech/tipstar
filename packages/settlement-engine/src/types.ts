import type { ISODateString, UUID } from "@sport-os/shared";

export interface TicketSelection {
  readonly selectionId: UUID;
  readonly eventId: string;
  readonly market: string;
  readonly selection: string;
  readonly oddsAtPublication: number | null;
}

/**
 * A ticket (Section 01 — Football Settlement Boundary). CRITICAL RULE: an
 * accumulator is ONE ticket regardless of how many selections it holds —
 * `selections` is never flattened into separate tickets anywhere in this
 * codebase (see rules.ts's `countTickets`).
 */
export interface Ticket {
  readonly ticketId: UUID;
  readonly selections: readonly TicketSelection[];
  readonly publishedAt: ISODateString;
}

export interface MatchResult {
  readonly eventId: string;
  readonly finalScore: string | null;
  readonly settledAt: ISODateString;
}

export const SettlementStatus = {
  WON: "won",
  LOST: "lost",
  VOID: "void",
  PUSH: "push",
  PENDING: "pending",
  CANCELLED: "cancelled",
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export interface Settlement {
  readonly settlementId: UUID;
  readonly ticketId: UUID;
  readonly status: SettlementStatus;
  readonly settledAt: ISODateString | null;
}

/**
 * A ticket that has been PUBLISHED (e.g. to a Telegram destination) — a
 * prediction, distinct from money changing hands. Never conflate this
 * with ExecutedWager (Section 01 — Football Settlement Boundary).
 */
export interface PublishedPrediction {
  readonly ticket: Ticket;
  readonly publishedAt: ISODateString;
  readonly destinationIds: readonly UUID[];
}

/**
 * A ticket that has actually been wagered with real stake. Section 01
 * forbids implementing real-money execution — this type exists only to
 * fix the future contract shape and keep it structurally distinct from a
 * PublishedPrediction (Security Principle: automation/execution is a
 * separate, independently-authorized concern from publishing).
 */
export interface ExecutedWager {
  readonly ticketId: UUID;
  readonly stake: number;
  readonly executedAt: ISODateString;
}

// ============================================================
// Section 08 — Settlement + Performance + Financial Accounting
// ============================================================
//
// "ANALYTICAL OUTCOME ≠ FINANCIAL OUTCOME." A prediction/ticket can be
// settled (WON/LOST/VOID/PUSH) without ever having been financially
// executed — see `TicketSettlement`/`LegSettlement`
// (`@sport-os/football-engine/settlement.ts`) and `DoubleBetSettlement`
// (`@sport-os/aviator-engine/settlement.ts`), both built on the
// primitives below. Actual financial P&L exists ONLY from a confirmed
// execution's real stake/payout — never inferred from a proposal, a risk
// limit, or a default configuration (§15/§51).

/** ISO 4217 code (e.g. "NGN", "KES", "USD") — application-validated, never a closed enum (no fixed operating-currency list exists), mirroring how `provider`/`market_type` are handled elsewhere in this codebase. */
export type Currency = string;

export interface Money {
  readonly amount: number;
  readonly currency: Currency;
}

/**
 * "The settlement engine must distinguish CALCULATED_SETTLEMENT from
 * ACTUAL_EXECUTION_PAYOUT." (§12) `PROVIDER` means a real execution
 * integration supplied this payout — authoritative or actual financial
 * accounting. `CALCULATED` means this codebase derived it from stake ×
 * odds — a labeled estimate, never treated as real money.
 */
export const PayoutSource = {
  PROVIDER: "PROVIDER",
  CALCULATED: "CALCULATED",
} as const;
export type PayoutSource = (typeof PayoutSource)[keyof typeof PayoutSource];

/**
 * "Paper results must be clearly labeled PAPER. Real-money performance
 * must be LIVE. Never mix them in the same financial performance
 * aggregate unless explicitly requested through a typed filter." (§22)
 * Every settlement/performance record this section produces carries one
 * of these — never inferred, never defaulted silently.
 */
export const LedgerMode = {
  PAPER: "PAPER",
  LIVE: "LIVE",
} as const;
export type LedgerMode = (typeof LedgerMode)[keyof typeof LedgerMode];

/**
 * An append-only settlement correction (§6/§9). "Corrections MUST use an
 * explicit settlement revision/correction mechanism... never destroy the
 * historical record." `originalSettlementId` is an opaque reference (a
 * football `TicketSettlement.settlementId` or an Aviator
 * `DoubleBetSettlement.settlementId`) — this type itself is sport-
 * agnostic, since a correction is the same shape regardless of what
 * produced the settlement being corrected.
 */
export interface SettlementRevision {
  readonly revisionId: UUID;
  readonly originalSettlementId: UUID;
  readonly previousStatus: SettlementStatus;
  readonly newStatus: SettlementStatus;
  readonly previousPayout: Money | null;
  readonly newPayout: Money | null;
  readonly reason: string;
  readonly source: string;
  /** The corrected result's version identifier (e.g. `MatchResult.id`), when the revision was triggered by a result correction — undefined for revisions triggered by other causes (e.g. a provider payout correction). */
  readonly resultVersionId: string | undefined;
  readonly createdAt: ISODateString;
  readonly createdBy: string;
}
