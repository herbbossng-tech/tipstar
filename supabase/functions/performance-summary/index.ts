// Supabase Edge Function (Deno runtime).
//
// GET /performance-summary?ledgerMode=&sport=&league=&market=&modelVersion=
//   &decisionPolicyVersion=&ticketType=&periodStart=&periodEnd=
// -> real `performance_ledger` rows (Section 09 §24/§27 — Performance
// Center / Performance Filters). Requires the `advanced_analytics`
// entitlement.
//
// Performs NO aggregation of its own — every row returned is already a
// computed `PerformanceLedgerEntry` (`@sport-os/settlement-engine`'s
// `buildPerformanceLedgerEntry()` output, persisted verbatim by Section
// 08). "Do not perform financial aggregation in React from raw rows" —
// this endpoint's job is exactly to make that unnecessary: it filters an
// already-aggregated table, never sums raw settlements itself. Filters
// are limited to `performance_ledger`'s own real dimension columns —
// there is no odds-bucket or EV-bucket dimension on this table, so those
// filters are not offered here (see OPEN_QUESTIONS.md).
//
// `ledgerMode` defaults to `LIVE` — a caller must explicitly ask for
// `PAPER` to see backtest/paper performance, so the two are never
// accidentally conflated in the default view (§22/§27 — paper and live
// must never be combined by default).

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireEntitlement, resolveAuthenticatedUser } from "../_shared/auth.ts";

const METHODS = "GET, OPTIONS";
const LIST_LIMIT = 100;
const VALID_LEDGER_MODES = new Set(["LIVE", "PAPER"]);

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

  const entitlement = await requireEntitlement(supabase, resolvedUser.user.id, "advanced_analytics");
  if (!entitlement.ok) return errorResponse(entitlement.code, entitlement.message, entitlement.status, headers);

  const url = new URL(req.url);
  const ledgerModeParam = url.searchParams.get("ledgerMode");
  const ledgerMode = ledgerModeParam && VALID_LEDGER_MODES.has(ledgerModeParam) ? ledgerModeParam : "LIVE";
  const sport = url.searchParams.get("sport");
  const league = url.searchParams.get("league");
  const market = url.searchParams.get("market");
  const modelVersion = url.searchParams.get("modelVersion");
  const decisionPolicyVersion = url.searchParams.get("decisionPolicyVersion");
  const ticketType = url.searchParams.get("ticketType");
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");

  let query = supabase
    .from("performance_ledger")
    .select(
      "id, period_start, period_end, ledger_mode, sport, league, market, model_version, decision_policy_version, ticket_type, ticket_count, leg_count, executed_ticket_count, settled_ticket_count, wins, losses, voids, pushes, pending, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, actual_pnl_amount, actual_pnl_currency, roi, expected_ev, max_drawdown, longest_losing_streak, sample_size",
    )
    .eq("ledger_mode", ledgerMode)
    .order("period_start", { ascending: false })
    .limit(LIST_LIMIT);

  if (sport) query = query.eq("sport", sport);
  if (league) query = query.eq("league", league);
  if (market) query = query.eq("market", market);
  if (modelVersion) query = query.eq("model_version", modelVersion);
  if (decisionPolicyVersion) query = query.eq("decision_policy_version", decisionPolicyVersion);
  if (ticketType) query = query.eq("ticket_type", ticketType);
  if (periodStart) query = query.gte("period_start", periodStart);
  if (periodEnd) query = query.lte("period_end", periodEnd);

  const { data: rows, error } = await query;
  if (error) return errorResponse("QUERY_FAILED", "Could not load performance data.", 500, headers);

  interface LedgerRow {
    id: string;
    period_start: string;
    period_end: string;
    ledger_mode: string;
    sport: string;
    league: string | null;
    market: string | null;
    model_version: string | null;
    decision_policy_version: string | null;
    ticket_type: string | null;
    ticket_count: number;
    leg_count: number;
    executed_ticket_count: number;
    settled_ticket_count: number;
    wins: number;
    losses: number;
    voids: number;
    pushes: number;
    pending: number;
    actual_stake_amount: number | null;
    actual_stake_currency: string | null;
    actual_payout_amount: number | null;
    actual_payout_currency: string | null;
    actual_pnl_amount: number | null;
    actual_pnl_currency: string | null;
    roi: number | null;
    expected_ev: number | null;
    max_drawdown: number | null;
    longest_losing_streak: number | null;
    sample_size: number;
  }

  const entries = ((rows as LedgerRow[] | null) ?? []).map((row) => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    ledgerMode: row.ledger_mode,
    sport: row.sport,
    league: row.league,
    market: row.market,
    modelVersion: row.model_version,
    decisionPolicyVersion: row.decision_policy_version,
    ticketType: row.ticket_type,
    ticketCount: row.ticket_count,
    legCount: row.leg_count,
    executedTicketCount: row.executed_ticket_count,
    settledTicketCount: row.settled_ticket_count,
    wins: row.wins,
    losses: row.losses,
    voids: row.voids,
    pushes: row.pushes,
    pending: row.pending,
    actualStake: row.actual_stake_amount !== null && row.actual_stake_currency !== null ? { amount: row.actual_stake_amount, currency: row.actual_stake_currency } : null,
    actualPayout: row.actual_payout_amount !== null && row.actual_payout_currency !== null ? { amount: row.actual_payout_amount, currency: row.actual_payout_currency } : null,
    actualPnl: row.actual_pnl_amount !== null && row.actual_pnl_currency !== null ? { amount: row.actual_pnl_amount, currency: row.actual_pnl_currency } : null,
    roi: row.roi,
    expectedEv: row.expected_ev,
    maxDrawdown: row.max_drawdown,
    longestLosingStreak: row.longest_losing_streak,
    sampleSize: row.sample_size,
  }));

  return jsonResponse({ ledgerMode, entries }, 200, headers);
});
