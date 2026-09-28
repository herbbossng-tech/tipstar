import { NotImplementedError } from "@sport-os/shared";
import type { MatchResult, Settlement, Ticket, TicketSelection } from "./types.js";

export interface TicketCandidate {
  readonly selections: readonly TicketSelection[];
}

/** TicketService — publishes prediction tickets. Real publication is a later-section concern (needs the Decision Engine). */
export interface TicketService {
  publish(candidate: TicketCandidate): Promise<Ticket>;
}

export class NotImplementedTicketService implements TicketService {
  async publish(_candidate: TicketCandidate): Promise<Ticket> {
    throw new NotImplementedError("TicketService.publish");
  }
}

/** SettlementService — resolves a ticket against a real match result. Real settlement logic is a later-section concern. */
export interface SettlementService {
  settle(ticketId: string, result: MatchResult): Promise<Settlement>;
}

export class NotImplementedSettlementService implements SettlementService {
  async settle(_ticketId: string, _result: MatchResult): Promise<Settlement> {
    throw new NotImplementedError("SettlementService.settle");
  }
}
