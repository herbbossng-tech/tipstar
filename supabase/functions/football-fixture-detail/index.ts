// Supabase Edge Function (Deno runtime).
//
// GET /football-fixture-detail?fixtureId=<uuid> -> one fixture's real
// match intelligence (Section 09 §12 — Match Intelligence View):
// fixture/competition/team info, the latest real result (if any), and
// the latest real Value Engine output per (market, selection, line),
// each linked to its finalized `decisions` row when one exists.
//
// Computes nothing itself — no EV, no probability, no fair odds. Every
// number returned is read verbatim from a real `value_evaluations`/
// `market_observations`/`decisions` row already produced by
// `evaluateValue()` (Section 07). A market with no evaluation yet is
// simply absent from the response — never backfilled with a guess.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireEntitlement, resolveAuthenticatedUser } from "../_shared/auth.ts";

const METHODS = "GET, OPTIONS";

interface FixtureRow {
  id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_kickoff_at: string;
  actual_kickoff_at: string | null;
  status: string;
}

interface MatchResultRow {
  home_goals: number;
  away_goals: number;
  halftime_home_goals: number | null;
  halftime_away_goals: number | null;
  result_recorded_at: string;
}

interface ValueEvaluationRow {
  id: string;
  market_type: string;
  selection: string;
  line: number | null;
  calibrated_probability: number | null;
  market_odds: number | null;
  fair_odds: number | null;
  edge: number | null;
  expected_value: number | null;
  data_quality: string | null;
  odds_timestamp: string | null;
  model_version: string | null;
  calculation_version: string;
  decision: string;
  reasons: string[];
  qualifies: boolean;
  evaluated_at: string;
}

interface DecisionRow {
  value_evaluation_id: string;
  outcome: string;
  reasons: string[];
  qualifies: boolean;
  decided_at: string;
}

/** Latest row per (market_type, selection, line) from an already `evaluated_at`-descending list — the same "most recent wins" pattern every point-in-time repository in this codebase already uses (see FOOTBALL_DATA_ARCHITECTURE.md). */
function latestPerMarket<T extends { market_type: string; selection: string; line: number | null }>(rowsDescending: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rowsDescending) {
    const key = `${row.market_type}|${row.selection}|${row.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
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

  const entitlement = await requireEntitlement(supabase, resolvedUser.user.id, "football_analysis");
  if (!entitlement.ok) return errorResponse(entitlement.code, entitlement.message, entitlement.status, headers);

  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId");
  if (!fixtureId) return errorResponse("VALIDATION_ERROR", "fixtureId is required.", 400, headers);

  const { data: fixtureRow, error: fixtureError } = await supabase.from("fixtures").select("id, competition_id, home_team_id, away_team_id, scheduled_kickoff_at, actual_kickoff_at, status").eq("id", fixtureId).maybeSingle();
  if (fixtureError) return errorResponse("QUERY_FAILED", "Could not load this fixture.", 500, headers);
  if (!fixtureRow) return errorResponse("NOT_FOUND", "This fixture could not be found.", 404, headers);
  const fixture = fixtureRow as FixtureRow;

  const [{ data: competitionRow }, { data: homeTeamRow }, { data: awayTeamRow }, { data: resultRows }, { data: valueRows }, { data: marketRows }] = await Promise.all([
    supabase.from("competitions").select("id, name, country").eq("id", fixture.competition_id).maybeSingle(),
    supabase.from("teams").select("id, name").eq("id", fixture.home_team_id).maybeSingle(),
    supabase.from("teams").select("id, name").eq("id", fixture.away_team_id).maybeSingle(),
    supabase.from("match_results").select("home_goals, away_goals, halftime_home_goals, halftime_away_goals, result_recorded_at").eq("fixture_id", fixtureId).order("result_recorded_at", { ascending: false }).order("version_seq", { ascending: false }).limit(1),
    supabase.from("value_evaluations").select("id, market_type, selection, line, calibrated_probability, market_odds, fair_odds, edge, expected_value, data_quality, odds_timestamp, model_version, calculation_version, decision, reasons, qualifies, evaluated_at").eq("fixture_id", fixtureId).order("evaluated_at", { ascending: false }).limit(200),
    supabase.from("market_observations").select("market_type, selection, line, odds, odds_timestamp, status").eq("fixture_id", fixtureId).order("odds_timestamp", { ascending: false }).limit(200),
  ]);

  const latestResult = ((resultRows as MatchResultRow[] | null) ?? [])[0] ?? null;
  const latestValueEvaluations = latestPerMarket((valueRows as ValueEvaluationRow[] | null) ?? []);
  const latestMarketObservations = latestPerMarket(
    ((marketRows as { market_type: string; selection: string; line: number | null; odds: number | null; odds_timestamp: string; status: string }[] | null) ?? []).map((r) => ({ ...r })),
  );

  const evaluationIds = latestValueEvaluations.map((v) => v.id);
  const { data: decisionRows } = evaluationIds.length > 0 ? await supabase.from("decisions").select("value_evaluation_id, outcome, reasons, qualifies, decided_at").in("value_evaluation_id", evaluationIds).order("decided_at", { ascending: false }) : { data: [] as DecisionRow[] };
  const latestDecisionByEvaluationId = new Map<string, DecisionRow>();
  for (const row of (decisionRows as DecisionRow[] | null) ?? []) {
    if (!latestDecisionByEvaluationId.has(row.value_evaluation_id)) latestDecisionByEvaluationId.set(row.value_evaluation_id, row);
  }

  const markets = latestValueEvaluations.map((evaluation) => {
    const decision = latestDecisionByEvaluationId.get(evaluation.id) ?? null;
    return {
      marketType: evaluation.market_type,
      selection: evaluation.selection,
      line: evaluation.line,
      modelProbability: evaluation.calibrated_probability,
      marketOdds: evaluation.market_odds,
      fairOdds: evaluation.fair_odds,
      edge: evaluation.edge,
      expectedValue: evaluation.expected_value,
      dataQuality: evaluation.data_quality,
      oddsTimestamp: evaluation.odds_timestamp,
      modelVersion: evaluation.model_version,
      calculationVersion: evaluation.calculation_version,
      valueEngineDecision: evaluation.decision,
      valueEngineReasons: evaluation.reasons,
      qualifies: evaluation.qualifies,
      evaluatedAt: evaluation.evaluated_at,
      finalizedDecision: decision ? { outcome: decision.outcome, reasons: decision.reasons, qualifies: decision.qualifies, decidedAt: decision.decided_at } : null,
    };
  });

  return jsonResponse(
    {
      fixture: {
        fixtureId: fixture.id,
        competition: (competitionRow as { id: string; name: string; country: string | null } | null) ?? null,
        homeTeam: (homeTeamRow as { id: string; name: string } | null) ?? null,
        awayTeam: (awayTeamRow as { id: string; name: string } | null) ?? null,
        scheduledKickoffAt: fixture.scheduled_kickoff_at,
        actualKickoffAt: fixture.actual_kickoff_at,
        status: fixture.status,
      },
      result: latestResult
        ? { homeGoals: latestResult.home_goals, awayGoals: latestResult.away_goals, halftimeHomeGoals: latestResult.halftime_home_goals, halftimeAwayGoals: latestResult.halftime_away_goals, resultRecordedAt: latestResult.result_recorded_at }
        : null,
      markets,
      marketObservations: latestMarketObservations.map((m) => ({ marketType: m.market_type, selection: m.selection, line: m.line, odds: m.odds, oddsTimestamp: m.odds_timestamp, status: m.status })),
    },
    200,
    headers,
  );
});
