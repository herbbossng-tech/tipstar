import type { SettlementLegView, TicketLegView } from "../api/types.js";
import { StatusBadge } from "./StatusBadge.js";
import { describeSettlementStatus } from "./statusPresentation.js";
import { formatMarketLabel, formatOdds, formatProbability } from "./format.js";

/** One leg of a ticket (Section 09 §17 — Accumulator UI). `settlement` is the matching `settlement_legs` row when the ticket has been settled — each leg's OWN status is shown alongside the ticket-level status, never substituted for it. */
export function TicketLegRow({ leg, settlement }: { readonly leg: TicketLegView; readonly settlement: SettlementLegView | null }): JSX.Element {
  return (
    <div className="ticket-leg">
      <div className="ticket-leg__market">{formatMarketLabel(leg.market_type, leg.selection, leg.line)}</div>
      <div className="ticket-leg__figures">
        <span>Probability {formatProbability(leg.probability)}</span>
        <span>Odds {formatOdds(leg.odds)}</span>
      </div>
      {leg.leakage_flag ? <p className="ticket-leg__warning">Flagged for potential data leakage.</p> : null}
      {settlement ? <StatusBadge {...describeSettlementStatus(settlement.status)} /> : null}
    </div>
  );
}
