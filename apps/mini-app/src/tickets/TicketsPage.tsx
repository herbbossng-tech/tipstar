import { useState } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { getTickets } from "../api/ticketsApi.js";
import type { TicketStatus } from "../api/types.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { TicketCard } from "../shared/TicketCard.js";

const STATUS_FILTERS: readonly { readonly value: TicketStatus | "ALL"; readonly label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "EXECUTED", label: "Executed" },
  { value: "AUTHORIZED", label: "Authorized" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Ticket Center (Section 09 §16). One row per ticket — an accumulator is never expanded into N rows. */
export function TicketsPage(): JSX.Element {
  const { session } = useAuthIdentity();
  const [status, setStatus] = useState<TicketStatus | "ALL">("ALL");
  const query = useQuery(() => getTickets(session.token, status === "ALL" ? {} : { status }), [session.token, status]);

  return (
    <section className="page">
      <h1>Tickets</h1>
      <div className="filter-row" role="tablist" aria-label="Filter tickets by status">
        {STATUS_FILTERS.map((filter) => (
          <button key={filter.value} type="button" role="tab" aria-selected={status === filter.value} className={`chip${status === filter.value ? " chip--active" : ""}`} onClick={() => setStatus(filter.value)}>
            {filter.label}
          </button>
        ))}
      </div>

      {query.status === "loading" ? <LoadingState label="Loading tickets…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}
      {query.status === "success" && query.data.tickets.length === 0 ? <EmptyState title="No tickets yet" message="Tickets will appear here once they're proposed." /> : null}
      {query.status === "success" && query.data.tickets.length > 0 ? (
        <div className="card-list">
          {query.data.tickets.map((ticket) => (
            <TicketCard key={ticket.ticketId} ticket={ticket} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
