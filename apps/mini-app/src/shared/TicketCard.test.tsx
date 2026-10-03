// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TicketSummary } from "../api/types.js";
import { TicketCard } from "./TicketCard.js";

function baseTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    ticketId: "t1",
    ticketType: "SINGLE",
    legCount: 1,
    status: "EXECUTED",
    stake: 10,
    combinedOdds: 1.85,
    createdAt: "2026-01-01T00:00:00Z",
    executionStatus: "EXECUTED",
    settlementStatus: "NOT_SETTLED",
    settlementWasRevised: false,
    actualStake: null,
    actualPayout: null,
    netPnl: null,
    roi: null,
    ...overrides,
  };
}

describe("TicketCard — financial NULL display (Section 09 §25)", () => {
  it("never renders a NULL actual stake as zero — shows the honest 'Not executed' fallback", () => {
    render(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ actualStake: null })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not executed/)).toBeInTheDocument();
    expect(screen.queryByText(/₦0|NGN 0|USD 0/)).not.toBeInTheDocument();
  });

  it("renders a real, non-null actual stake as a real amount, not a fallback", () => {
    render(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ actualStake: { amount: 500, currency: "NGN" } })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Not executed/)).not.toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("renders a real ZERO net P&L (a settled push) distinctly from a NULL net P&L (never executed)", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ netPnl: null })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not available/)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ netPnl: { amount: 0, currency: "NGN" } })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Not available/)).not.toBeInTheDocument();
  });
});

describe("TicketCard — accumulator display (Section 09 §17)", () => {
  it("renders an accumulator as ONE card labeled with its real leg count — never as multiple rows", () => {
    render(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ ticketType: "ACCUMULATOR", legCount: 5 })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Accumulator.*5 legs/)).toBeInTheDocument();
  });

  it("shows settlement revision state when the backend reports one", () => {
    render(
      <MemoryRouter>
        <TicketCard ticket={baseTicket({ settlementWasRevised: true })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Settlement revised/)).toBeInTheDocument();
  });
});
