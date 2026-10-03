// Supabase Edge Function (Deno runtime).
//
// GET /football-fixtures?date=YYYY-MM-DD&competitionId=<uuid> -> a list
// of real fixtures for one UTC day (Section 09 §11 — Football Command
// Center). Requires a valid session + the `football_analysis`
// entitlement on a usable license. Never fabricates a fixture, a
// prediction, or a market availability flag — `hasIntelligence`/
// `hasMarketData` are real existence checks against `value_evaluations`/
// `market_observations`, not an inferred or guessed value.
//
// This endpoint is read-only and computes nothing: it does not run the
// Value Engine, does not compute probabilities, and does not decide
// anything. It reports what already exists in the Section 04/07 schema.

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

interface CompetitionRow {
  id: string;
  name: string;
  country: string | null;
}

interface TeamRow {
  id: string;
  name: string;
}

function parseDateParam(raw: string | null): { start: string; end: string; date: string } {
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  const start = `${date}T00:00:00.000Z`;
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end, date };
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
  const { start, end, date } = parseDateParam(url.searchParams.get("date"));
  const competitionId = url.searchParams.get("competitionId");

  let query = supabase.from("fixtures").select("id, competition_id, home_team_id, away_team_id, scheduled_kickoff_at, actual_kickoff_at, status").gte("scheduled_kickoff_at", start).lt("scheduled_kickoff_at", end).order("scheduled_kickoff_at", { ascending: true });
  if (competitionId) query = query.eq("competition_id", competitionId);

  const { data: fixtureRows, error: fixturesError } = await query;
  if (fixturesError) return errorResponse("QUERY_FAILED", "Could not load fixtures.", 500, headers);
  const fixtures = (fixtureRows ?? []) as FixtureRow[];

  if (fixtures.length === 0) {
    return jsonResponse({ date, fixtures: [] }, 200, headers);
  }

  const competitionIds = [...new Set(fixtures.map((f) => f.competition_id))];
  const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
  const fixtureIds = fixtures.map((f) => f.id);

  const [{ data: competitionRows }, { data: teamRows }, { data: marketRows }, { data: valueRows }] = await Promise.all([
    supabase.from("competitions").select("id, name, country").in("id", competitionIds),
    supabase.from("teams").select("id, name").in("id", teamIds),
    supabase.from("market_observations").select("fixture_id").in("fixture_id", fixtureIds),
    supabase.from("value_evaluations").select("fixture_id").in("fixture_id", fixtureIds),
  ]);

  const competitionsById = new Map((competitionRows as CompetitionRow[] | null ?? []).map((c) => [c.id, c]));
  const teamsById = new Map((teamRows as TeamRow[] | null ?? []).map((t) => [t.id, t]));
  const fixtureIdsWithMarketData = new Set((marketRows as { fixture_id: string }[] | null ?? []).map((r) => r.fixture_id));
  const fixtureIdsWithIntelligence = new Set((valueRows as { fixture_id: string }[] | null ?? []).map((r) => r.fixture_id));

  const response = fixtures.map((fixture) => ({
    fixtureId: fixture.id,
    competition: competitionsById.get(fixture.competition_id) ?? null,
    homeTeam: teamsById.get(fixture.home_team_id) ?? null,
    awayTeam: teamsById.get(fixture.away_team_id) ?? null,
    scheduledKickoffAt: fixture.scheduled_kickoff_at,
    actualKickoffAt: fixture.actual_kickoff_at,
    status: fixture.status,
    hasMarketData: fixtureIdsWithMarketData.has(fixture.id),
    hasIntelligence: fixtureIdsWithIntelligence.has(fixture.id),
  }));

  return jsonResponse({ date, fixtures: response }, 200, headers);
});
