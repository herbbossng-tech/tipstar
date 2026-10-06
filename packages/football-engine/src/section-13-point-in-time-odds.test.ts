import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { normalizeOddsApiOdds } from "./adapters/odds-api-provider.js";
import { ingestOddsObservations, type IngestionDependencies } from "./ingestion.js";
import { InMemoryFixtureExternalIdentitiesRepository } from "./repositories/fixture-identities.js";
import { InMemoryFixturesRepository, InMemoryMatchEventsRepository, InMemoryMatchResultsRepository } from "./repositories/fixtures.js";
import { InMemoryIngestionRunsRepository } from "./repositories/ingestion-runs.js";
import { InMemoryOddsObservationsRepository, InMemoryTeamObservationsRepository } from "./repositories/observations.js";
import { InMemoryQuarantineRepository } from "./repositories/quality.js";
import { InMemoryCompetitionsRepository, InMemorySeasonsRepository, InMemoryTeamsRepository } from "./repositories/reference-data.js";

/**
 * Section 13's own literal, MUST-have point-in-time regression test:
 *
 *   "fixture kickoff=T, odds snapshots at T-180m/T-120m/T-60m/T-10m/T+30m;
 *    a query at T-90m must NOT see T-60m/T-10m/T+30m; a query at T-5m
 *    MUST see the latest valid snapshot at or before T-5m; ingestion
 *    time must never override provider observation time when resolving
 *    historical availability."
 *
 * Two layers, both required: the repository primitive directly (the
 * mechanism), and the full ingestion pipeline through a real provider
 * normalizer (proof the mechanism is actually reachable end to end, not
 * just correct in isolation) — same pairing as section-05-leakage.test.ts.
 */

const KICKOFF = "2026-02-01T18:00:00Z"; // T
const SNAPSHOT_T_MINUS_180 = "2026-02-01T15:00:00Z";
const SNAPSHOT_T_MINUS_120 = "2026-02-01T16:00:00Z";
const SNAPSHOT_T_MINUS_60 = "2026-02-01T17:00:00Z";
const SNAPSHOT_T_MINUS_10 = "2026-02-01T17:50:00Z";
const SNAPSHOT_T_PLUS_30 = "2026-02-01T18:30:00Z";
const QUERY_T_MINUS_90 = "2026-02-01T16:30:00Z";
const QUERY_T_MINUS_5 = "2026-02-01T17:55:00Z";

describe("Section 13 — point-in-time odds retrieval (repository primitive)", () => {
  it("a query at T-90m sees only T-180m/T-120m, never T-60m/T-10m/T+30m", async () => {
    const repo = new InMemoryOddsObservationsRepository();
    const fixtureId = generateId();
    const base = { fixtureId, marketType: "match_result_1x2", selection: "home", odds: 2.0, bookmakerSource: "test", provider: "the-odds-api", providerObservationId: undefined, ingestionRunId: undefined, temporalReliability: "confirmed" as const };

    for (const observedAt of [SNAPSHOT_T_MINUS_180, SNAPSHOT_T_MINUS_120, SNAPSHOT_T_MINUS_60, SNAPSHOT_T_MINUS_10, SNAPSHOT_T_PLUS_30]) {
      await repo.insert({ ...base, observedAt, providerPublishedAt: observedAt });
    }

    const atMinus90 = await repo.listForFixtureAsOf(fixtureId, QUERY_T_MINUS_90);
    expect(atMinus90.map((o) => o.observedAt)).toEqual([SNAPSHOT_T_MINUS_180, SNAPSHOT_T_MINUS_120]);
    expect(atMinus90.some((o) => o.observedAt === SNAPSHOT_T_MINUS_60)).toBe(false);
    expect(atMinus90.some((o) => o.observedAt === SNAPSHOT_T_MINUS_10)).toBe(false);
    expect(atMinus90.some((o) => o.observedAt === SNAPSHOT_T_PLUS_30)).toBe(false);
    // The latest valid snapshot at T-90m is T-120m.
    expect(atMinus90.at(-1)?.observedAt).toBe(SNAPSHOT_T_MINUS_120);
  });

  it("a query at T-5m sees the latest valid snapshot at or before it (T-10m), never the post-kickoff T+30m one", async () => {
    const repo = new InMemoryOddsObservationsRepository();
    const fixtureId = generateId();
    const base = { fixtureId, marketType: "match_result_1x2", selection: "home", odds: 2.0, bookmakerSource: "test", provider: "the-odds-api", providerObservationId: undefined, ingestionRunId: undefined, temporalReliability: "confirmed" as const };

    for (const observedAt of [SNAPSHOT_T_MINUS_180, SNAPSHOT_T_MINUS_120, SNAPSHOT_T_MINUS_60, SNAPSHOT_T_MINUS_10, SNAPSHOT_T_PLUS_30]) {
      await repo.insert({ ...base, observedAt, providerPublishedAt: observedAt });
    }

    const atMinus5 = await repo.listForFixtureAsOf(fixtureId, QUERY_T_MINUS_5);
    expect(atMinus5).toHaveLength(4);
    expect(atMinus5.some((o) => o.observedAt === SNAPSHOT_T_PLUS_30)).toBe(false);
    expect(atMinus5.at(-1)?.observedAt).toBe(SNAPSHOT_T_MINUS_10);
  });
});

describe("Section 13 — point-in-time odds retrieval (full ingestion pipeline, real provider normalizer)", () => {
  function buildDeps(): IngestionDependencies {
    return {
      competitions: new InMemoryCompetitionsRepository(),
      seasons: new InMemorySeasonsRepository(),
      teams: new InMemoryTeamsRepository(),
      fixtures: new InMemoryFixturesRepository(),
      matchResults: new InMemoryMatchResultsRepository(),
      matchEvents: new InMemoryMatchEventsRepository(),
      teamObservations: new InMemoryTeamObservationsRepository(),
      oddsObservations: new InMemoryOddsObservationsRepository(),
      ingestionRuns: new InMemoryIngestionRunsRepository(),
      quarantine: new InMemoryQuarantineRepository(),
    };
  }

  it("ingestion time never overrides provider observation time: 5 historical snapshots ingested at the SAME real ingestion moment still resolve availability strictly by their own (distinct) snapshot timestamps", async () => {
    const deps = buildDeps();
    const fixture = await deps.fixtures.upsert({
      competitionId: (await deps.competitions.upsert({ provider: "sportmonks", providerCompetitionId: "L1", name: "Test League", country: undefined, competitionType: undefined, active: true })).id,
      seasonId: undefined,
      homeTeamId: (await deps.teams.upsert({ provider: "sportmonks", providerTeamId: "T1", name: "Home FC", shortName: undefined, country: undefined })).id,
      awayTeamId: (await deps.teams.upsert({ provider: "sportmonks", providerTeamId: "T2", name: "Away FC", shortName: undefined, country: undefined })).id,
      scheduledKickoffAt: KICKOFF,
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "sportmonks",
      providerFixtureId: "SM-FIX-1",
    });

    // All 5 are "fetched" (normalized/ingested) at the exact same wall-clock
    // ingestion moment ("now") — their only distinguishing timestamp is
    // each one's own `snapshot_timestamp`, exactly like 5 separate
    // historical-endpoint calls made back-to-back in one job run.
    const ingestionMoment = "2026-02-01T20:00:00.000Z"; // long after every snapshot AND after kickoff
    const rawOdds = [SNAPSHOT_T_MINUS_180, SNAPSHOT_T_MINUS_120, SNAPSHOT_T_MINUS_60, SNAPSHOT_T_MINUS_10, SNAPSHOT_T_PLUS_30].map((snapshotTimestamp, i) => ({
      event_id: "ODDS-EVT-1",
      market_key: "h2h",
      outcome_name: "Home FC",
      home_team: "Home FC",
      away_team: "Away FC",
      outcome_price: 2.0 + i * 0.1,
      bookmaker_key: "pinnacle",
      snapshot_timestamp: snapshotTimestamp,
    }));

    // Pre-populate the identity mapping exactly like the odds-ingestion job would after a confident team-name match — not the subject of this test.
    const identities = new InMemoryFixtureExternalIdentitiesRepository();
    await identities.recordMapping({ fixtureId: fixture.id, provider: "the-odds-api", providerFixtureId: "ODDS-EVT-1", matchMethod: "team_name_kickoff_time" });

    const run = await ingestOddsObservations(deps, "the-odds-api", "live", rawOdds, (raw) => normalizeOddsApiOdds(raw, ingestionMoment), identities);
    expect(run.recordsInserted).toBe(5);
    expect(run.recordsRejected).toBe(0);

    const atMinus90 = await deps.oddsObservations.listForFixtureAsOf(fixture.id, QUERY_T_MINUS_90);
    expect(atMinus90.map((o) => o.observedAt)).toEqual([SNAPSHOT_T_MINUS_180, SNAPSHOT_T_MINUS_120].map((t) => new Date(t).toISOString()));

    const atMinus5 = await deps.oddsObservations.listForFixtureAsOf(fixture.id, QUERY_T_MINUS_5);
    expect(atMinus5).toHaveLength(4);
    expect(atMinus5.at(-1)?.observedAt).toBe(new Date(SNAPSHOT_T_MINUS_10).toISOString());
    expect(atMinus5.some((o) => o.observedAt === new Date(SNAPSHOT_T_PLUS_30).toISOString())).toBe(false);

    // Querying as of the actual ingestion moment (long after everything) correctly sees all 5 — proving the earlier exclusions were genuinely about observedAt, not some side effect of ingestion ordering.
    const atIngestionMoment = await deps.oddsObservations.listForFixtureAsOf(fixture.id, ingestionMoment);
    expect(atIngestionMoment).toHaveLength(5);
  });
});
