import { Link } from "react-router-dom";
import { getTickets } from "../api/ticketsApi.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { TicketCard } from "../shared/TicketCard.js";

const HOME_TICKET_PREVIEW_COUNT = 3;

/** The most recent real tickets, never fabricated (Section 09 §9/§16). Links through to the full Ticket Center. */
export function RecentTicketsCard({ sessionToken }: { readonly sessionToken: string }): JSX.Element {
  const query = useQuery(() => getTickets(sessionToken), [sessionToken]);

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">Recent tickets</h2>
        <Link to="/tickets" className="card__link">
          View all
        </Link>
      </div>
      {query.status === "loading" ? <LoadingState label="Loading tickets…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} /> : null}
      {query.status === "success" && query.data.tickets.length === 0 ? <EmptyState title="No tickets yet" message="Tickets will appear here once they're proposed." /> : null}
      {query.status === "success" && query.data.tickets.length > 0 ? (
        <div className="card-list">
          {query.data.tickets.slice(0, HOME_TICKET_PREVIEW_COUNT).map((ticket) => (
            <TicketCard key={ticket.ticketId} ticket={ticket} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
