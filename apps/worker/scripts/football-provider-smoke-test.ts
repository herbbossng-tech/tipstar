/* eslint-disable no-console -- this is a manual CLI diagnostic script; console output IS its product, not a leftover debug statement. */
import { fetchOddsApiLiveOdds, fetchSportmonksCompetitions, type ProviderConfig } from "@sport-os/football-engine";

/**
 * Section 13 — OPTIONAL real-provider smoke test (spec requirement:
 * "explicit env-gated, read-only, never writes to production, never
 * bypasses normalization, clearly self-identifies, never required by
 * default CI").
 *
 * This is a plain script, NOT a `*.test.ts` file — vitest.config.ts's
 * own `include` glob can never match this path, so `npm run test` /
 * `npx vitest run` (the default CI path) can NEVER accidentally execute
 * it. It is run explicitly and only:
 *
 *   npm run smoke-test:football-providers --workspace=apps/worker
 *
 * READ-ONLY: it calls ONLY the adapters' own fetch functions (plain
 * HTTP GET requests against the real provider APIs). It never calls
 * ingestion.ts, never constructs a Supabase client, never writes to
 * public.fixtures/competitions/odds_observations or any other table —
 * there is no write path in this file at all, so there is nothing to
 * "bypass" into canonical storage. Its only purpose is to prove "do
 * these real credentials and this adapter's HTTP/parsing code actually
 * work against the real provider", nothing more — see
 * docs/architecture/FOOTBALL_PROVIDER_INTEGRATION.md.
 */

function readEnv(name: string): string | undefined {
  return process.env[name];
}

async function main(): Promise<void> {
  console.log("=== Section 13 football provider smoke test — READ-ONLY, manual opt-in, self-identifying ===");

  const confirm = readEnv("FOOTBALL_PROVIDER_SMOKE_TEST_CONFIRM");
  if (confirm !== "I_UNDERSTAND_THIS_CALLS_REAL_PROVIDER_APIS") {
    console.log('Refusing to run: set FOOTBALL_PROVIDER_SMOKE_TEST_CONFIRM="I_UNDERSTAND_THIS_CALLS_REAL_PROVIDER_APIS" to opt in explicitly.');
    process.exitCode = 1;
    return;
  }

  const sportmonksKey = readEnv("SPORTMONKS_API_KEY") ?? readEnv("FOOTBALL_DATA_API_KEY");
  const sportmonksLeagueId = readEnv("SMOKE_TEST_SPORTMONKS_LEAGUE_ID");
  const oddsKey = readEnv("ODDS_API_KEY");
  const oddsSportKey = readEnv("SMOKE_TEST_ODDS_SPORT_KEY");

  if (sportmonksKey && sportmonksLeagueId) {
    console.log(`\n--- Sportmonks: fetching competition ${sportmonksLeagueId} (one read-only GET) ---`);
    const config: ProviderConfig = { provider: "sportmonks", enabled: true, baseUrl: undefined, apiKey: sportmonksKey, timeoutMs: 10_000, maxRetries: 1, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined };
    const result = await fetchSportmonksCompetitions(config, [sportmonksLeagueId]);
    console.log("Sportmonks outcome status:", result.status);
    if (result.status === "ok") {
      console.log(`Fetched ${result.records.length} raw competition record(s). Top-level field keys of the first record:`, result.records[0] ? Object.keys(result.records[0]) : "(none)");
    } else if (result.status === "unavailable") {
      console.log("Reason:", result.reason);
    } else {
      console.log("Retry-after seconds:", result.retryAfterSeconds);
    }
  } else {
    console.log("\n--- Sportmonks: SKIPPED (requires both SPORTMONKS_API_KEY/FOOTBALL_DATA_API_KEY and SMOKE_TEST_SPORTMONKS_LEAGUE_ID) ---");
  }

  if (oddsKey && oddsSportKey) {
    console.log(`\n--- The Odds API: fetching live odds for sport "${oddsSportKey}" (one read-only GET) ---`);
    const config: ProviderConfig = { provider: "the-odds-api", enabled: true, baseUrl: undefined, apiKey: oddsKey, timeoutMs: 10_000, maxRetries: 1, rateLimitPerMinute: undefined, pollIntervalSeconds: undefined };
    const result = await fetchOddsApiLiveOdds(config, oddsSportKey);
    console.log("The Odds API outcome status:", result.status);
    if (result.status === "ok") {
      console.log(`Fetched ${result.records.length} flattened (event, bookmaker, market, outcome) record(s).`);
    } else if (result.status === "unavailable") {
      console.log("Reason:", result.reason);
    } else {
      console.log("Retry-after seconds:", result.retryAfterSeconds);
    }
  } else {
    console.log("\n--- The Odds API: SKIPPED (requires both ODDS_API_KEY and SMOKE_TEST_ODDS_SPORT_KEY) ---");
  }

  console.log("\n=== Done. No database was written to; no ingestion/normalization write path was invoked. ===");
}

main().catch((error: unknown) => {
  console.error("Smoke test failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
