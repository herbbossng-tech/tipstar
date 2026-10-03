// Supabase Edge Function (Deno runtime).
//
// GET /ticket-detail?ticketId=<uuid> -> one ticket's full real detail
// (Section 09 §16/§17/§18/§20/§28 — Ticket Center / Accumulator UI /
// Execution UX / Risk UI / Settlement View): legs (§17 — one ticket, N
// legs, never N tickets), the risk evaluation(s) that gated it, its
// execution request/result history, and its settlement (including any
// revision history — §28: "if a settlement was corrected, display that
// the settlement was revised").
//
// Requires the `football_tickets` entitlement. Computes nothing — every
// field is read verbatim from the real Section 07/08 schema.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireEntitlement, resolveAuthenticatedUser } from "../_shared/auth.ts";
import { resolveEffectiveSettlement, type SettlementRevisionRow } from "../_shared/settlement.ts";

const METHODS = "GET, OPTIONS";

interface TicketRow {
  id: string;
  ticket_type: string;
  version: number;
  status: string;
  stake: number | null;
  potential_return: number | null;
  combined_odds: number | null;
  combined_probability: number | null;
  combined_probability_method: string | null;
  combined_probability_calculation_version: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
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
  const ticketId = url.searchParams.get("ticketId");
  if (!ticketId) return errorResponse("VALIDATION_ERROR", "ticketId is required.", 400, headers);

  const { data: ticketRow, error: ticketError } = await supabase
    .from("tickets")
    .select("id, ticket_type, version, status, stake, potential_return, combined_odds, combined_probability, combined_probability_method, combined_probability_calculation_version, rejection_reason, created_at, updated_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) return errorResponse("QUERY_FAILED", "Could not load this ticket.", 500, headers);
  if (!ticketRow) return errorResponse("NOT_FOUND", "This ticket could not be found.", 404, headers);
  const ticket = ticketRow as TicketRow;

  const [{ data: legRows }, { data: decisionRows }, { data: riskRows }, { data: executionRequestRows }, { data: settlementRows }] = await Promise.all([
    supabase.from("ticket_legs").select("id, fixture_id, market_type, selection, line, probability, odds, fair_odds, expected_value, edge, model_version, calculation_version, value_evaluated_at, leakage_flag").eq("ticket_id", ticketId),
    supabase.from("decisions").select("outcome, reasons, qualifies, decided_at").eq("ticket_id", ticketId).order("decided_at", { ascending: false }),
    supabase.from("risk_evaluations").select("risk_code, reasons, approved, reason, proposed_stake, projected_daily_stake, projected_daily_ticket_count, policy_version, evaluated_at").eq("ticket_id", ticketId).order("evaluated_at", { ascending: false }),
    supabase.from("execution_requests").select("id, execution_mode, stake, market_type, selection, odds, user_confirmed, gate_authorized, gate_failed_check, gate_denial_code, gate_denial_reason, requested_at").eq("ticket_id", ticketId).order("requested_at", { ascending: false }),
    supabase
      .from("settlements")
      .select("id, status, settlement_policy_version, ledger_mode, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, payout_source, calculated_return_amount, calculated_return_currency, net_pnl_amount, net_pnl_currency, roi, settled_at, ticket_version")
      .eq("ticket_id", ticketId)
      .order("ticket_version", { ascending: false }),
  ]);

  interface ExecutionRequestRow {
    readonly id: string;
    readonly execution_mode: string;
    readonly stake: number;
    readonly market_type: string | null;
    readonly selection: string | null;
    readonly odds: number | null;
    readonly user_confirmed: boolean;
    readonly gate_authorized: boolean;
    readonly gate_failed_check: string | null;
    readonly gate_denial_code: string | null;
    readonly gate_denial_reason: string | null;
    readonly requested_at: string;
  }
  interface ExecutionResultRow {
    readonly execution_request_id: string;
    readonly status: string;
    readonly external_reference: string | null;
    readonly stake: number | null;
    readonly executed_at: string | null;
    readonly recorded_at: string;
  }

  const executionRequests = (executionRequestRows as ExecutionRequestRow[] | null) ?? [];
  const executionRequestIds = executionRequests.map((r) => r.id);
  const { data: executionResultRows } = executionRequestIds.length > 0 ? await supabase.from("execution_results").select("execution_request_id, status, external_reference, stake, executed_at, recorded_at").in("execution_request_id", executionRequestIds).order("recorded_at", { ascending: false }) : { data: [] as ExecutionResultRow[] };
  const resultsByRequest = new Map<string, ExecutionResultRow[]>();
  for (const row of (executionResultRows as ExecutionResultRow[] | null) ?? []) {
    const list = resultsByRequest.get(row.execution_request_id) ?? [];
    list.push(row);
    resultsByRequest.set(row.execution_request_id, list);
  }

  const settlementRow = ((settlementRows as { id: string; status: string; settlement_policy_version: string; ledger_mode: string; actual_stake_amount: number | null; actual_stake_currency: string | null; actual_payout_amount: number | null; actual_payout_currency: string | null; payout_source: string | null; calculated_return_amount: number | null; calculated_return_currency: string | null; net_pnl_amount: number | null; net_pnl_currency: string | null; roi: number | null; settled_at: string | null; ticket_version: number }[] | null) ?? [])[0] ?? null;

  let settlement = null;
  if (settlementRow) {
    const { data: legSettlementRows } = await supabase.from("settlement_legs").select("fixture_id, market_type, selection, line, odds, status, result_version_id, reason").eq("settlement_id", settlementRow.id);
    const { data: revisionRows } = await supabase.from("settlement_revisions").select("revision_id:id, previous_status, new_status, previous_payout_amount, previous_payout_currency, new_payout_amount, new_payout_currency, reason, source, result_version_id, created_at, created_by").eq("original_settlement_id", settlementRow.id).order("created_at", { ascending: true });
    const revisions = (revisionRows as (SettlementRevisionRow & { revision_id: string; previous_status: string; reason: string; source: string; result_version_id: string | null; created_by: string })[] | null) ?? [];
    const effective = resolveEffectiveSettlement(settlementRow.status, settlementRow.actual_payout_amount, settlementRow.actual_payout_currency, revisions);

    settlement = {
      settlementId: settlementRow.id,
      originalStatus: settlementRow.status,
      effectiveStatus: effective.status,
      settlementPolicyVersion: settlementRow.settlement_policy_version,
      ledgerMode: settlementRow.ledger_mode,
      actualStake: settlementRow.actual_stake_amount !== null && settlementRow.actual_stake_currency !== null ? { amount: settlementRow.actual_stake_amount, currency: settlementRow.actual_stake_currency } : null,
      actualPayout: effective.payoutAmount !== null && effective.payoutCurrency !== null ? { amount: effective.payoutAmount, currency: effective.payoutCurrency } : null,
      payoutSource: settlementRow.payout_source,
      calculatedReturn: settlementRow.calculated_return_amount !== null && settlementRow.calculated_return_currency !== null ? { amount: settlementRow.calculated_return_amount, currency: settlementRow.calculated_return_currency } : null,
      netPnl: settlementRow.net_pnl_amount !== null && settlementRow.net_pnl_currency !== null ? { amount: settlementRow.net_pnl_amount, currency: settlementRow.net_pnl_currency } : null,
      roi: settlementRow.roi,
      settledAt: settlementRow.settled_at,
      legs: (legSettlementRows as { fixture_id: string; market_type: string; selection: string; line: number | null; odds: number; status: string; result_version_id: string | null; reason: string }[] | null) ?? [],
      revisions: revisions.map((r) => ({ revisionId: r.revision_id, previousStatus: r.previous_status, newStatus: r.new_status, previousPayout: r.previous_payout_amount !== null && r.previous_payout_currency !== null ? { amount: r.previous_payout_amount, currency: r.previous_payout_currency } : null, newPayout: r.new_payout_amount !== null && r.new_payout_currency !== null ? { amount: r.new_payout_amount, currency: r.new_payout_currency } : null, reason: r.reason, source: r.source, createdAt: r.created_at })),
    };
  }

  return jsonResponse(
    {
      ticket: {
        ticketId: ticket.id,
        ticketType: ticket.ticket_type,
        version: ticket.version,
        status: ticket.status,
        stake: ticket.stake,
        potentialReturn: ticket.potential_return,
        combinedOdds: ticket.combined_odds,
        combinedProbability: ticket.combined_probability,
        combinedProbabilityMethod: ticket.combined_probability_method,
        combinedProbabilityCalculationVersion: ticket.combined_probability_calculation_version,
        rejectionReason: ticket.rejection_reason,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
      },
      legs: (legRows as { id: string; fixture_id: string; market_type: string; selection: string; line: number | null; probability: number; odds: number; fair_odds: number | null; expected_value: number | null; edge: number | null; model_version: string | null; calculation_version: string; value_evaluated_at: string; leakage_flag: boolean }[] | null) ?? [],
      decisions: decisionRows ?? [],
      risk: riskRows ?? [],
      execution: executionRequests.map((request) => ({
        requestId: request.id,
        executionMode: request.execution_mode,
        stake: request.stake,
        marketType: request.market_type,
        selection: request.selection,
        odds: request.odds,
        userConfirmed: request.user_confirmed,
        gateAuthorized: request.gate_authorized,
        gateFailedCheck: request.gate_failed_check,
        gateDenialCode: request.gate_denial_code,
        gateDenialReason: request.gate_denial_reason,
        requestedAt: request.requested_at,
        results: resultsByRequest.get(request.id) ?? [],
      })),
      settlement,
    },
    200,
    headers,
  );
});
