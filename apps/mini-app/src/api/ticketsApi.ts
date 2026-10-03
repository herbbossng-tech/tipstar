import { authedGet } from "../services/api.js";
import type { TicketDetailResponse, TicketsResponse, TicketStatus } from "./types.js";

/** Fetches the real ticket list from `/tickets` (Section 09 §16). One row per ticket, regardless of leg count — never expanded to one row per leg. */
export async function getTickets(sessionToken: string, params: { readonly status?: TicketStatus } = {}): Promise<TicketsResponse> {
  return authedGet<TicketsResponse>("/tickets", sessionToken, params);
}

/** Fetches one ticket's full real detail — legs, decisions, risk, execution, settlement — from `/ticket-detail` (Section 09 §16/§17/§18/§20/§28). */
export async function getTicketDetail(sessionToken: string, ticketId: string): Promise<TicketDetailResponse> {
  return authedGet<TicketDetailResponse>("/ticket-detail", sessionToken, { ticketId });
}
