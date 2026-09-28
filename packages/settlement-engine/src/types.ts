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
