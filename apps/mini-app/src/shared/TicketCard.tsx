import { Link } from "react-router-dom";
import type { TicketSummary } from "../api/types.js";
import { StatusBadge } from "./StatusBadge.js";
import { describeExecutionStatus, describeSettlementStatus, describeTicketStatus } from "./statusPresentation.js";
import { formatDateTime, formatMoney, formatOdds } from "./format.js";

/**
 * One ticket row in the Ticket Center list (Section 09 §16/§17 — Ticket
 * Center / Accumulator UI). "ONE TICKET, N LEGS" — an accumulator is
 * never rendered as N rows; `legCount` is shown as metadata on this
 * single card. Financial figures use the null-safe `formatMoney`
 * fallbacks (§25) — a never-executed ticket shows "Not executed", never
 * "₦0".
 */
export function TicketCard({ ticket }: { readonly ticket: TicketSummary }): JSX.Element {
  return (
    <Link to={`/tickets/${ticket.ticketId}`} className="ticket-card">
      <div className="ticket-card__header">
        <span className="ticket-card__type">{ticket.ticketType === "ACCUMULATOR" ? `Accumulator · ${ticket.legCount} legs` : "Single"}</span>
        <StatusBadge {...describeTicketStatus(ticket.status)} />
      </div>
      <div className="ticket-card__badges">
        <StatusBadge {...describeExecutionStatus(ticket.executionStatus)} />
        <StatusBadge {...describeSettlementStatus(ticket.settlementStatus)} />
        {ticket.settlementWasRevised ? <span className="tag tag--muted">Settlement revised</span> : null}
      </div>
      <div className="ticket-card__meta">
        <span>Odds {formatOdds(ticket.combinedOdds)}</span>
        <span>{formatDateTime(ticket.createdAt)}</span>
      </div>
      <div className="ticket-card__financials">
        <span>Stake: {formatMoney(ticket.actualStake, "Not executed")}</span>
        <span>P&amp;L: {formatMoney(ticket.netPnl, "Not available")}</span>
      </div>
    </Link>
  );
}
