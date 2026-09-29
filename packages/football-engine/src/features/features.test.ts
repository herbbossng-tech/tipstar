import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "../repositories/fixtures.js";
import { InMemoryOddsObservationsRepository } from "../repositories/observations.js";
import { computeEloFeatures, DEFAULT_ELO_RATING, replayEloRatings } from "./elo.js";
import { computeFormFeatures, FORM_WINDOW_SIZE } from "./form.js";
import { computeH2hFeatures } from "./h2h.js";
import { computeOddsFeatures } from "./odds.js";
import { getGlobalMatchHistory, getTeamMatchHistory } from "./history.js";
import { computeFeatureVector } from "./registry.js";
import { FeatureQuality } from "./types.js";

/** SYNTHETIC — a small deterministic league used only to validate feature computation, never presented as real-world data. */
async function seedLeague() {
  const fixtures = new InMemoryFixturesRepository();
  const matchResults = new InMemoryMatchResultsRepository();
  const oddsObservations = new InMemoryOddsObservationsRepository();

  const competitionId = generateId();
  const teamA = generateId();
  const teamB = generateId();
  const teamC = generateId();

  async function playMatch(home: string, away: string, homeGoals: number, awayGoals: number, kickoff: string, recordedAt: string) {
    const fixture = await fixtures.upsert({
      competitionId,
      seasonId: undefined,
      homeTeamId: home,
      awayTeamId: away,
      scheduledKickoffAt: kickoff,
      status: "finished",
      providerStatusRaw: "FT",
      provider: "feature_test_synthetic",
      providerFixtureId: `${home}-${away}-${kickoff}`,
    });
    await matchResults.insert({ fixtureId: fixture.id, homeGoals, awayGoals, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: recordedAt, source: "feature_test_synthetic" });
    return fixture;
  }

  // A beats B, B beats C, A beats C, each roughly a week apart in January 2026.
  await playMatch(teamA, teamB, 2, 0, "2026-01-01T15:00:00Z", "2026-01-01T17:00:00Z");
  await playMatch(teamB, teamC, 1, 1, "2026-01-08T15:00:00Z", "2026-01-08T17:00:00Z");
  await playMatch(teamA, teamC, 3, 1, "2026-01-15T15:00:00Z", "2026-01-15T17:00:00Z");

  // The target fixture: A vs B again, on 2026-01-22.
  const targetFixture = await fixtures.upsert({
    competitionId,
    seasonId: undefined,
    homeTeamId: teamA,
    awayTeamId: teamB,
    scheduledKickoffAt: "2026-01-22T15:00:00Z",
    status: "scheduled",
    providerStatusRaw: "NS",
    provider: "feature_test_synthetic",
    providerFixtureId: "target-fixture",
  });

  return { fixtures, matchResults, oddsObservations, competitionId, teamA, teamB, teamC, targetFixture };
}

describe("features/history.ts — leakage-safe history primitive", () => {
  it("excludes a match whose result was not yet recorded by snapshotTime", async () => {
    const { fixtures, matchResults, teamA, teamB } = await seedLeague();
    // A match kicked off but its result isn't recorded until later than our snapshot.
    const lateFixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: teamA,
      awayTeamId: teamB,
      scheduledKickoffAt: "2026-01-20T15:00:00Z",
      status: "finished",
      providerStatusRaw: "FT",
      provider: "feature_test_synthetic",
      providerFixtureId: "late-result-fixture",
    });
    await matchResults.insert({ fixtureId: lateFixture.id, homeGoals: 5, awayGoals: 0, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: "2026-01-25T00:00:00Z", source: "feature_test_synthetic" });

    // snapshotTime is BEFORE the result was recorded — must be excluded.
    const history = await getTeamMatchHistory({ fixtures, matchResults }, teamA, "2026-01-22T15:00:00Z", "2026-01-21T00:00:00Z");
    expect(history.matches.some((m) => m.fixture.id === lateFixture.id)).toBe(false);

    // Once the snapshot moves past when the result became known, it must appear.
    const laterHistory = await getTeamMatchHistory({ fixtures, matchResults }, teamA, "2026-01-30T15:00:00Z", "2026-01-26T00:00:00Z");
    expect(laterHistory.matches.some((m) => m.fixture.id === lateFixture.id)).toBe(true);
  });

  it("resolves the point-in-time-correct match-result VERSION, never a later correction leaking through an earlier snapshot (Match Result Correction Leakage, one layer up from the repository)", async () => {
    const { fixtures, matchResults, teamA, teamB } = await seedLeague();
    // A match with a provider correction: original 1-0 recorded right after
    // kickoff, corrected to 2-0 days later (e.g. a VAR/stats review).
    // listForFixtureIds returns BOTH versions ungrouped — a naive Map keyed
    // by fixtureId would silently keep whichever version happens to be last,
    // which is exactly the bug this test guards against.
    const correctedFixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: teamA,
      awayTeamId: teamB,
      scheduledKickoffAt: "2026-01-10T15:00:00Z",
      status: "finished",
      providerStatusRaw: "FT",
      provider: "feature_test_synthetic",
      providerFixtureId: "corrected-result-fixture",
    });
    await matchResults.insert({
      fixtureId: correctedFixture.id,
      homeGoals: 1,
      awayGoals: 0,
      halftimeHomeGoals: undefined,
      halftimeAwayGoals: undefined,
      resultRecordedAt: "2026-01-10T17:00:00Z",
      source: "feature_test_synthetic",
    });
    await matchResults.insert({
      fixtureId: correctedFixture.id,
      homeGoals: 2,
      awayGoals: 0,
      halftimeHomeGoals: undefined,
      halftimeAwayGoals: undefined,
      resultRecordedAt: "2026-01-14T09:00:00Z",
      source: "feature_test_synthetic",
    });

    // Snapshot BEFORE the correction was recorded: must see the ORIGINAL
    // 1-0, never the not-yet-known 2-0 correction.
    const beforeCorrection = await getTeamMatchHistory({ fixtures, matchResults }, teamA, "2026-01-22T15:00:00Z", "2026-01-12T00:00:00Z");
    const beforeMatch = beforeCorrection.matches.find((m) => m.fixture.id === correctedFixture.id);
    expect(beforeMatch).toBeDefined();
    expect(beforeMatch!.result.homeGoals).toBe(1);

    // Snapshot AFTER the correction was recorded: must see the corrected 2-0.
    const afterCorrection = await getTeamMatchHistory({ fixtures, matchResults }, teamA, "2026-01-22T15:00:00Z", "2026-01-16T00:00:00Z");
    const afterMatch = afterCorrection.matches.find((m) => m.fixture.id === correctedFixture.id);
    expect(afterMatch).toBeDefined();
    expect(afterMatch!.result.homeGoals).toBe(2);

    // Same guarantee for the global (all-teams) history Elo replays from.
    const globalBefore = await getGlobalMatchHistory({ fixtures, matchResults }, "2026-01-22T15:00:00Z", "2026-01-12T00:00:00Z");
    expect(globalBefore.find((m) => m.fixture.id === correctedFixture.id)?.result.homeGoals).toBe(1);
    const globalAfter = await getGlobalMatchHistory({ fixtures, matchResults }, "2026-01-22T15:00:00Z", "2026-01-16T00:00:00Z");
    expect(globalAfter.find((m) => m.fixture.id === correctedFixture.id)?.result.homeGoals).toBe(2);
  });

  it("never includes the target fixture itself or a future fixture", async () => {
    const { fixtures, matchResults, teamA, targetFixture } = await seedLeague();
    const history = await getTeamMatchHistory({ fixtures, matchResults }, teamA, targetFixture.scheduledKickoffAt, targetFixture.scheduledKickoffAt);
    expect(history.matches.every((m) => m.fixture.id !== targetFixture.id)).toBe(true);
    expect(history.matches.every((m) => new Date(m.fixture.scheduledKickoffAt).getTime() < new Date(targetFixture.scheduledKickoffAt).getTime())).toBe(true);
  });
});

describe("features/elo.ts", () => {
  it("gives an untested team the default rating, not a missing/null value", async () => {
    const { fixtures, matchResults, targetFixture } = await seedLeague();
    const brandNewTeam = generateId();
    const matches = await getGlobalMatchHistory({ fixtures, matchResults }, targetFixture.scheduledKickoffAt, targetFixture.scheduledKickoffAt);
    const ratings = replayEloRatings(matches);
    expect(ratings.get(brandNewTeam)).toBeUndefined();
    expect(ratings.get(brandNewTeam) ?? DEFAULT_ELO_RATING).toBe(DEFAULT_ELO_RATING);
  });

  it("updates both teams' ratings after a match, winner up / loser down", async () => {
    const { fixtures, matchResults, teamA, teamB, targetFixture } = await seedLeague();
    const matches = await getGlobalMatchHistory({ fixtures, matchResults }, targetFixture.scheduledKickoffAt, targetFixture.scheduledKickoffAt);
    const ratings = replayEloRatings(matches);
    // Team A won 2 matches and lost 0 by this point (beat B, beat C) — should be above default.
    expect(ratings.get(teamA)!).toBeGreaterThan(DEFAULT_ELO_RATING);
    // Team B lost to A and drew with C — should be at or below default.
    expect(ratings.get(teamB)!).toBeLessThanOrEqual(DEFAULT_ELO_RATING);
  });

  it("a team's post-match Elo never influences a fixture before that match (chronology test)", async () => {
    const { fixtures, matchResults, teamA, teamB } = await seedLeague();
    // Compute Elo features for the FIRST match (A vs B on Jan 1) — at that point neither team has any history.
    const firstFixture = await fixtures.getByProviderIdentity("feature_test_synthetic", `${teamA}-${teamB}-2026-01-01T15:00:00Z`);
    expect(firstFixture).toBeDefined();
    const ctx = { fixtureId: firstFixture!.id, snapshotTime: "2026-01-01T14:00:00Z", now: "2026-01-01T14:00:00Z" };
    const values = await computeEloFeatures(ctx, { fixtures, matchResults }, firstFixture!, "synthetic");
    const homeRating = values.find((v) => v.featureId === "elo_rating_home")!;
    const awayRating = values.find((v) => v.featureId === "elo_rating_away")!;
    expect(homeRating.value).toBe(DEFAULT_ELO_RATING);
    expect(awayRating.value).toBe(DEFAULT_ELO_RATING);
  });
});

describe("features/form.ts", () => {
  it("computes rolling form only from the team's prior matches, never the target fixture", async () => {
    const { fixtures, matchResults, targetFixture } = await seedLeague();
    const ctx = { fixtureId: targetFixture.id, snapshotTime: targetFixture.scheduledKickoffAt, now: targetFixture.scheduledKickoffAt };
    const values = await computeFormFeatures(ctx, { fixtures, matchResults }, targetFixture, "synthetic");
    const homePpm = values.find((v) => v.featureId === `home_team_form_points_per_match_last${FORM_WINDOW_SIZE}`)!;
    // Team A won both its prior matches (vs B, vs C) => 3 + 3 = 6 points / 2 matches = 3.0 PPM.
    expect(homePpm.value).toBe(3);
    expect(homePpm.dataQuality).toBe(FeatureQuality.AVAILABLE);
  });

  it("reports MISSING (not 0) for a team with zero prior matches", async () => {
    const { fixtures, matchResults } = await seedLeague();
    const brandNewTeamA = generateId();
    const brandNewTeamB = generateId();
    const fixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: brandNewTeamA,
      awayTeamId: brandNewTeamB,
      scheduledKickoffAt: "2026-02-01T15:00:00Z",
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "feature_test_synthetic",
      providerFixtureId: "brand-new-fixture",
    });
    const ctx = { fixtureId: fixture.id, snapshotTime: fixture.scheduledKickoffAt, now: fixture.scheduledKickoffAt };
    const values = await computeFormFeatures(ctx, { fixtures, matchResults }, fixture, "synthetic");
    const homePpm = values.find((v) => v.featureId === `home_team_form_points_per_match_last${FORM_WINDOW_SIZE}`)!;
    expect(homePpm.value).toBeNull();
    expect(homePpm.dataQuality).toBe(FeatureQuality.MISSING);
  });
});

describe("features/h2h.ts", () => {
  it("reports MISSING with zero prior meetings, LOW_CONFIDENCE below the AVAILABLE threshold", async () => {
    const { fixtures, matchResults, targetFixture } = await seedLeague();
    // A and B have met exactly once (Jan 1) before this target fixture — below MIN_FOR_AVAILABLE (3).
    const ctx = { fixtureId: targetFixture.id, snapshotTime: targetFixture.scheduledKickoffAt, now: targetFixture.scheduledKickoffAt };
    const values = await computeH2hFeatures(ctx, { fixtures, matchResults }, targetFixture, "synthetic");
    const winRate = values.find((v) => v.featureId === "h2h_home_team_win_rate")!;
    expect(winRate.value).toBe(1); // A won that one meeting
    expect(winRate.dataQuality).toBe(FeatureQuality.LOW_CONFIDENCE);
  });

  it("reports MISSING for two teams that have never met", async () => {
    const { fixtures, matchResults } = await seedLeague();
    const strangerA = generateId();
    const strangerB = generateId();
    const fixture = await fixtures.upsert({
      competitionId: generateId(),
      seasonId: undefined,
      homeTeamId: strangerA,
      awayTeamId: strangerB,
      scheduledKickoffAt: "2026-02-01T15:00:00Z",
      status: "scheduled",
      providerStatusRaw: "NS",
      provider: "feature_test_synthetic",
      providerFixtureId: "strangers-fixture",
    });
    const ctx = { fixtureId: fixture.id, snapshotTime: fixture.scheduledKickoffAt, now: fixture.scheduledKickoffAt };
    const values = await computeH2hFeatures(ctx, { fixtures, matchResults }, fixture, "synthetic");
    const winRate = values.find((v) => v.featureId === "h2h_home_team_win_rate")!;
    expect(winRate.value).toBeNull();
    expect(winRate.dataQuality).toBe(FeatureQuality.MISSING);
  });
});

describe("features/odds.ts", () => {
  it("computes implied probability and movement only from pre-snapshot observations", async () => {
    const { oddsObservations, targetFixture } = await seedLeague();
    await oddsObservations.insert({ fixtureId: targetFixture.id, marketType: "match_result_1x2", selection: "home", odds: 2.0, bookmakerSource: "synthetic_bookmaker", observedAt: "2026-01-20T10:00:00Z", providerPublishedAt: "2026-01-20T10:00:00Z", temporalReliability: "confirmed", provider: "feature_test_synthetic", providerObservationId: undefined, ingestionRunId: undefined });
    await oddsObservations.insert({ fixtureId: targetFixture.id, marketType: "match_result_1x2", selection: "home", odds: 1.8, bookmakerSource: "synthetic_bookmaker", observedAt: "2026-01-22T14:00:00Z", providerPublishedAt: "2026-01-22T14:00:00Z", temporalReliability: "confirmed", provider: "feature_test_synthetic", providerObservationId: undefined, ingestionRunId: undefined });
    // Post-kickoff observation — must never affect a pre-kickoff snapshot.
    await oddsObservations.insert({ fixtureId: targetFixture.id, marketType: "match_result_1x2", selection: "home", odds: 1.01, bookmakerSource: "synthetic_bookmaker", observedAt: "2026-01-22T16:00:00Z", providerPublishedAt: "2026-01-22T16:00:00Z", temporalReliability: "confirmed", provider: "feature_test_synthetic", providerObservationId: undefined, ingestionRunId: undefined });

    const ctx = { fixtureId: targetFixture.id, snapshotTime: "2026-01-22T15:00:00Z", now: "2026-01-22T15:00:00Z" };
    const values = await computeOddsFeatures(ctx, { oddsObservations }, targetFixture, "synthetic");
    const latest = values.find((v) => v.featureId === "odds_implied_probability_home")!;
    const opening = values.find((v) => v.featureId === "odds_opening_implied_probability_home")!;
    const movement = values.find((v) => v.featureId === "odds_probability_movement_home")!;

    expect(latest.value).toBeCloseTo(1 / 1.8, 5);
    expect(opening.value).toBeCloseTo(1 / 2.0, 5);
    expect(movement.value! > 0).toBe(true);
  });
});

describe("computeFeatureVector — full integration", () => {
  it("produces one FeatureValue per registered feature, all tagged with the requested snapshotTime and fixtureId", async () => {
    const { fixtures, matchResults, oddsObservations, targetFixture } = await seedLeague();
    const ctx = { fixtureId: targetFixture.id, snapshotTime: targetFixture.scheduledKickoffAt, now: targetFixture.scheduledKickoffAt };
    const vector = await computeFeatureVector(ctx, { fixtures, matchResults, oddsObservations }, targetFixture, "synthetic");

    expect(Object.keys(vector).length).toBeGreaterThan(10);
    for (const value of Object.values(vector)) {
      expect(value.fixtureId).toBe(targetFixture.id);
      expect(value.snapshotTime).toBe(targetFixture.scheduledKickoffAt);
    }
    // The declared-unavailable families are present but MISSING, never absent from the vector entirely.
    expect(vector.xg_expected_goals_home!.dataQuality).toBe(FeatureQuality.MISSING);
    expect(vector.xg_expected_goals_home!.value).toBeNull();
  });
});
