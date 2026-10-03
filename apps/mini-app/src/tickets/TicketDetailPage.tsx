import { useParams } from "react-router-dom";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getTicketDetail } from "../api/ticketsApi.js";
import type { SettlementLegView, TicketLegView } from "../api/types.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { TicketLegRow } from "../shared/TicketLegRow.js";
import { describeExecutionStatus, describeRiskApproval, describeSettlementStatus, describeTicketStatus } from "../shared/statusPresentation.js";
import { formatDateTime, formatMoney, formatOdds, formatPercent } from "../shared/format.js";

function findSettlementLeg(legs: readonly SettlementLegView[], leg: TicketLegView): SettlementLegView | null {
  return legs.find((s) => s.fixture_id === leg.fixture_id && s.market_type === leg.market_type && s.selection === leg.selection && s.line === leg.line) ?? null;
}

/**
 * Ticket detail (Section 09 §16/§17/§18/§19/§20/§28). "ONE TICKET, N
 * LEGS" — legs are listed under one ticket-level status, never as
 * separate tickets. Execution/risk/settlement state is read verbatim;
 * nothing here recomputes a settlement or a risk decision.
 */
export function TicketDetailPage(): JSX.Element {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { session } = useAuthIdentity();
  const query = useQuery(() => getTicketDetail(session.token, ticketId!), [session.token, ticketId]);

  if (!ticketId) {
    return <EmptyState title="Ticket not found" message="No ticket was specified." />;
  }

  return (
    <section className="page">
      {query.status === "loading" ? <LoadingState label="Loading ticket…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}

      {query.status === "success" ? (
        <>
          <div className="ticket-header">
            <h1>{query.data.ticket.ticketType === "ACCUMULATOR" ? `Accumulator · ${query.data.legs.length} legs` : "Single"}</h1>
            <div className="ticket-header__badges">
              <StatusBadge {...describeTicketStatus(query.data.ticket.status)} />
            </div>
            <p className="page__subtitle">Combined odds {formatOdds(query.data.ticket.combinedOdds)}</p>
            {query.data.ticket.rejectionReason ? <p className="ticket-header__rejection">Rejection reason: {query.data.ticket.rejectionReason}</p> : null}
          </div>

          <h2 className="section-heading">Legs</h2>
          <div className="card-list">
            {query.data.legs.map((leg) => (
              <TicketLegRow key={leg.id} leg={leg} settlement={query.data.settlement ? findSettlementLeg(query.data.settlement.legs, leg) : null} />
            ))}
          </div>

          <h2 className="section-heading">Risk</h2>
          {query.data.risk.length === 0 ? (
            <EmptyState title="No risk evaluation" message="No risk evaluation has been recorded for this ticket." />
          ) : (
            <div className="card-list">
              {query.data.risk.map((risk) => (
                <div className="card" key={`${risk.risk_code}-${risk.evaluated_at}`}>
                  <StatusBadge {...describeRiskApproval(risk.approved)} />
                  <p className="card__detail">{risk.reason}</p>
                  <p className="card__meta">Policy {risk.policy_version} · {formatDateTime(risk.evaluated_at)}</p>
                </div>
              ))}
            </div>
          )}

          <h2 className="section-heading">Execution</h2>
          {query.data.execution.length === 0 ? (
            <EmptyState title="Not executed" message="This ticket has not been submitted for execution." />
          ) : (
            <div className="card-list">
              {query.data.execution.map((request) => {
                const latestResult = request.results[0] ?? null;
                return (
                  <div className="card" key={request.requestId}>
                    <StatusBadge {...describeExecutionStatus(latestResult ? latestResult.status : "REQUESTED")} />
                    <p className="card__detail">Mode: {request.executionMode}</p>
                    {!request.gateAuthorized ? <p className="card__detail">Denied: {request.gateDenialReason ?? request.gateDenialCode ?? "Not authorized"}</p> : null}
                    <p className="card__meta">{formatDateTime(request.requestedAt)}</p>
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="section-heading">Settlement</h2>
          {!query.data.settlement ? (
            <EmptyState title="Not settled" message="This ticket has not been settled yet." />
          ) : (
            <div className="card">
              <StatusBadge {...describeSettlementStatus(query.data.settlement.effectiveStatus)} />
              {query.data.settlement.revisions.length > 0 ? <p className="card__detail">This settlement was revised {query.data.settlement.revisions.length} time(s). Original outcome: {describeSettlementStatus(query.data.settlement.originalStatus).label}.</p> : null}
              <dl className="value-card__grid">
                <div>
                  <dt>Actual stake</dt>
                  <dd>{formatMoney(query.data.settlement.actualStake, "Not executed")}</dd>
                </div>
                <div>
                  <dt>Actual payout</dt>
                  <dd>{formatMoney(query.data.settlement.actualPayout, query.data.settlement.effectiveStatus === "PENDING" ? "Pending" : "Not available")}</dd>
                </div>
                <div>
                  <dt>Net P&amp;L</dt>
                  <dd>{formatMoney(query.data.settlement.netPnl, "Not available")}</dd>
                </div>
                <div>
                  <dt>ROI</dt>
                  <dd>{formatPercent(query.data.settlement.roi)}</dd>
                </div>
              </dl>
              <p className="card__meta">Settlement policy {query.data.settlement.settlementPolicyVersion} · {query.data.settlement.ledgerMode}</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
