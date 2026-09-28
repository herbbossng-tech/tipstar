import { err, ok, ValidationError, type Result } from "@sport-os/shared";
import type { Ticket } from "./types.js";

/**
 * The number of tickets in a set — NEVER the number of selections.
 * (Section 01 critical rule: "An accumulator is ONE ticket regardless of
 * the number of selections.")
 */
export function countTickets(tickets: readonly Ticket[]): number {
  return tickets.length;
}

/** True when a ticket has more than one selection (a multi/accumulator) — still one ticket. */
export function isAccumulator(ticket: Ticket): boolean {
  return ticket.selections.length > 1;
}

export function validateTicket(ticket: Ticket): Result<Ticket, ValidationError> {
  if (ticket.selections.length === 0) {
    return err(new ValidationError({ message: "A ticket must have at least one selection.", context: { ticketId: ticket.ticketId } }));
  }
  const eventIds = new Set(ticket.selections.map((selection) => selection.eventId));
  if (eventIds.size !== ticket.selections.length) {
    return err(
      new ValidationError({
        message: "A ticket cannot contain more than one selection for the same event.",
        context: { ticketId: ticket.ticketId },
      }),
    );
  }
  return ok(ticket);
}
