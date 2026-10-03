// Supabase Edge Function (Deno runtime).
//
// GET /tickets?status=<TicketStatus> -> the real ticket list (Section 09
// §16 — Ticket Center). Requires the `football_tickets` entitlement.
//
// "A 5-leg accumulator that loses is 1 LOST TICKET, not 5 LOST TICKETS"
// — this endpoint returns exactly one row per `tickets` row (never one
// per leg); `legCount` is reported alongside, never used to expand the
// list. Execution/settlement state is read verbatim from
// `execution_requests`/`execution_results`/`settlements`/
// `settlement_revisions` — a ticket with no execution_requests row is
// reported as `executionStatus: "NOT_EXECUTED"` (a distinct state from
// any real `ExecutionResultStatus`, never fabricated as one), and a
// ticket with no settlements row is reported as
// `settlementStatus: "NOT_SETTLED"` (distinct from the real `PENDING`
// settlement state).

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireEntitlement, resolveAuthenticatedUser } from "../_shared/auth.ts";
import { resolveEffectiveSettlement, type SettlementRevisionRow } from "../_shared/settlement.ts";

const METHODS = "GET, OPTIONS";
const LIST_LIMIT = 50;

interface TicketRow {
  id: string;
  ticket_type: string;
  version: number;
  status: string;
  stake: number | null;
  combined_odds: number | null;
  created_at: string;
}

interface ExecutionRequestRow {
  id: string;
  ticket_id: string | null;
  requested_at: string;
  gate_authorized: boolean;
}

interface ExecutionResultRow {
  execution_request_id: string;
  status: string;
  recorded_at: string;
}

interface SettlementRow {
  id: string;
  ticket_id: string;
  ticket_version: number;
  status: string;
  actual_stake_amount: number | null;
  actual_stake_currency: string | null;
  actual_payout_amount: number | null;
  actual_payout_currency: string | null;
  net_pnl_amount: number | null;
  net_pnl_currency: string | null;
  roi: number | null;
  settled_at: string | null;
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(METHODS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported.", 405, headers);

  const token = bearerToken(req);
  if (!token) return errorResponse("SESSION_MISSING", "No session token was provided.", 401, headers);

  const config = readServerConfig(Deno.env);
  if (!config) return errorResponse("NOT_CONFIGURED", "This endpoint is not configured.", 500, headers);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const resolvedUser = await resolveAuthenticatedUser(supabase, token, config.sessionSigningSecret);
  if (!resolvedUser.ok) return errorResponse(resolvedUser.code, resolvedUser.message, resolvedUser.status, headers);

  const entitlement = await requireEntitlement(supabase, resolvedUser.user.id, "football_tickets");
  if (!entitlement.ok) return errorResponse(entitlement.code, entitlement.message, entitlement.status, headers);

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  let query = supabase.from("tickets").select("id, ticket_type, version, status, stake, combined_odds, created_at").order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (status) query = query.eq("status", status);

  const { data: ticketRows, error: ticketsError } = await query;
  if (ticketsError) return errorResponse("QUERY_FAILED", "Could not load tickets.", 500, headers);
  const tickets = (ticketRows as TicketRow[] | null) ?? [];

  if (tickets.length === 0) {
    return jsonResponse({ tickets: [] }, 200, headers);
  }

  const ticketIds = tickets.map((t) => t.id);

  const [{ data: legRows }, { data: executionRequestRows }, { data: settlementRows }] = await Promise.all([
    supabase.from("ticket_legs").select("ticket_id").in("ticket_id", ticketIds),
    supabase.from("execution_requests").select("id, ticket_id, requested_at, gate_authorized").in("ticket_id", ticketIds).order("requested_at", { ascending: false }),
    supabase.from("settlements").select("id, ticket_id, ticket_version, status, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, net_pnl_amount, net_pnl_currency, roi, settled_at").in("ticket_id", ticketIds),
  ]);

  const legCountByTicket = new Map<string, number>();
  for (const row of (legRows as { ticket_id: string }[] | null) ?? []) {
    legCountByTicket.set(row.ticket_id, (legCountByTicket.get(row.ticket_id) ?? 0) + 1);
  }

  const executionRequests = (executionRequestRows as ExecutionRequestRow[] | null) ?? [];
  const latestExecutionRequestByTicket = new Map<string, ExecutionRequestRow>();
  for (const row of executionRequests) {
    if (row.ticket_id && !latestExecutionRequestByTicket.has(row.ticket_id)) latestExecutionRequestByTicket.set(row.ticket_id, row);
  }
  const executionRequestIds = executionRequests.map((r) => r.id);
  const { data: executionResultRows } = executionRequestIds.length > 0 ? await supabase.from("execution_results").select("execution_request_id, status, recorded_at").in("execution_request_id", executionRequestIds).order("recorded_at", { ascending: false }) : { data: [] as ExecutionResultRow[] };
  const latestExecutionResultByRequest = new Map<string, ExecutionResultRow>();
  for (const row of (executionResultRows as ExecutionResultRow[] | null) ?? []) {
    if (!latestExecutionResultByRequest.has(row.execution_request_id)) latestExecutionResultByRequest.set(row.execution_request_id, row);
  }

  const settlements = (settlementRows as SettlementRow[] | null) ?? [];
  const settlementsByTicket = new Map<string, SettlementRow>();
  for (const ticket of tickets) {
    const match = settlements.find((s) => s.ticket_id === ticket.id && s.ticket_version === ticket.version) ?? settlements.filter((s) => s.ticket_id === ticket.id).sort((a, b) => b.ticket_version - a.ticket_version)[0];
    if (match) settlementsByTicket.set(ticket.id, match);
  }
  const settlementIds = [...settlementsByTicket.values()].map((s) => s.id);
  const { data: revisionRows } = settlementIds.length > 0 ? await supabase.from("settlement_revisions").select("original_settlement_id, new_status, new_payout_amount, new_payout_currency, created_at").in("original_settlement_id", settlementIds) : { data: [] as (SettlementRevisionRow & { original_settlement_id: string })[] };
  const revisionsBySettlement = new Map<string, SettlementRevisionRow[]>();
  for (const row of (revisionRows as (SettlementRevisionRow & { original_settlement_id: string })[] | null) ?? []) {
    const list = revisionsBySettlement.get(row.original_settlement_id) ?? [];
    list.push(row);
    revisionsBySettlement.set(row.original_settlement_id, list);
  }

  const response = tickets.map((ticket) => {
    const executionRequest = latestExecutionRequestByTicket.get(ticket.id) ?? null;
    const executionResult = executionRequest ? (latestExecutionResultByRequest.get(executionRequest.id) ?? null) : null;
    const settlement = settlementsByTicket.get(ticket.id) ?? null;
    const effective = settlement ? resolveEffectiveSettlement(settlement.status, settlement.actual_payout_amount, settlement.actual_payout_currency, revisionsBySettlement.get(settlement.id) ?? []) : null;

    return {
      ticketId: ticket.id,
      ticketType: ticket.ticket_type,
      legCount: legCountByTicket.get(ticket.id) ?? 0,
      status: ticket.status,
      stake: ticket.stake,
      combinedOdds: ticket.combined_odds,
      createdAt: ticket.created_at,
      executionStatus: executionResult ? executionResult.status : executionRequest ? "REQUESTED" : "NOT_EXECUTED",
      settlementStatus: effective ? effective.status : "NOT_SETTLED",
      settlementWasRevised: (effective?.revisionCount ?? 0) > 0,
      actualStake: settlement && settlement.actual_stake_amount !== null && settlement.actual_stake_currency !== null ? { amount: settlement.actual_stake_amount, currency: settlement.actual_stake_currency } : null,
      actualPayout: effective && effective.payoutAmount !== null && effective.payoutCurrency !== null ? { amount: effective.payoutAmount, currency: effective.payoutCurrency } : null,
      netPnl: settlement && settlement.net_pnl_amount !== null && settlement.net_pnl_currency !== null ? { amount: settlement.net_pnl_amount, currency: settlement.net_pnl_currency } : null,
      roi: settlement?.roi ?? null,
    };
  });

  return jsonResponse({ tickets: response }, 200, headers);
});
