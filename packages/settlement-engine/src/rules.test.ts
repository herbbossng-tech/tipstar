import { describe, expect, it } from "vitest";
import { countTickets, isAccumulator, validateTicket } from "./rules.js";
import type { Ticket, TicketSelection } from "./types.js";

function buildSelection(overrides: Partial<TicketSelection> = {}): TicketSelection {
  return { selectionId: "sel-1", eventId: "event-1", market: "1x2", selection: "home", oddsAtPublication: 1.8, ...overrides };
}

function buildTicket(selections: TicketSelection[], overrides: Partial<Ticket> = {}): Ticket {
  return { ticketId: "ticket-1", selections, publishedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("countTickets — the accumulator invariant", () => {
  it("a single-selection ticket counts as one ticket", () => {
    const ticket = buildTicket([buildSelection()]);
    expect(countTickets([ticket])).toBe(1);
  });

  it("a five-selection accumulator STILL counts as one ticket, not five", () => {
    const selections = Array.from({ length: 5 }, (_, i) => buildSelection({ selectionId: `sel-${i}`, eventId: `event-${i}` }));
    const ticket = buildTicket(selections);
    expect(countTickets([ticket])).toBe(1);
    expect(ticket.selections).toHaveLength(5);
  });

  it("counts multiple tickets correctly regardless of each one's selection count", () => {
    const single = buildTicket([buildSelection()], { ticketId: "t1" });
    const accumulator = buildTicket(
      [buildSelection({ selectionId: "s1", eventId: "e1" }), buildSelection({ selectionId: "s2", eventId: "e2" }), buildSelection({ selectionId: "s3", eventId: "e3" })],
      { ticketId: "t2" },
    );
    expect(countTickets([single, accumulator])).toBe(2);
  });
});

describe("isAccumulator", () => {
  it("is false for a single-selection ticket", () => {
    expect(isAccumulator(buildTicket([buildSelection()]))).toBe(false);
  });

  it("is true once a ticket has more than one selection", () => {
    const ticket = buildTicket([buildSelection({ selectionId: "s1", eventId: "e1" }), buildSelection({ selectionId: "s2", eventId: "e2" })]);
    expect(isAccumulator(ticket)).toBe(true);
  });
});

describe("validateTicket", () => {
  it("rejects a ticket with zero selections", () => {
    const result = validateTicket(buildTicket([]));
    expect(result.ok).toBe(false);
  });

  it("rejects a ticket with two selections on the same event", () => {
    const ticket = buildTicket([buildSelection({ selectionId: "s1" }), buildSelection({ selectionId: "s2" })]);
    const result = validateTicket(ticket);
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed accumulator across distinct events", () => {
    const ticket = buildTicket([buildSelection({ selectionId: "s1", eventId: "e1" }), buildSelection({ selectionId: "s2", eventId: "e2" })]);
    const result = validateTicket(ticket);
    expect(result.ok).toBe(true);
  });
});
