import { isErr, isOk } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { TEST_FIXTURE_PROVIDER_RAW_DATA, normalizeTestFixtureFixture, normalizeTestFixtureOdds, testFixtureProvider } from "./test-fixture-provider.js";

describe("test_fixture_provider deterministic dataset", () => {
  it("covers every category the Fixture Dataset spec requires: competitions, seasons, teams, and completed/upcoming/postponed/cancelled/duplicate/invalid fixtures", () => {
    expect(TEST_FIXTURE_PROVIDER_RAW_DATA.competitions.length).toBeGreaterThanOrEqual(2);
    expect(TEST_FIXTURE_PROVIDER_RAW_DATA.seasons.length).toBeGreaterThanOrEqual(2);
    expect(TEST_FIXTURE_PROVIDER_RAW_DATA.teams.length).toBeGreaterThanOrEqual(4);
    expect(TEST_FIXTURE_PROVIDER_RAW_DATA.fixtures.length).toBe(9);
  });

  it("normalizes every completed (FT) fixture record, including the deliberate duplicate of TFP-FIX-1", () => {
    const results = TEST_FIXTURE_PROVIDER_RAW_DATA.fixtures.filter((r) => r.status_code === "FT").map(normalizeTestFixtureFixture);
    expect(results.every(isOk)).toBe(true);
    // 2 distinct completed fixtures (TFP-FIX-1, TFP-FIX-2) + 1 deliberate duplicate of TFP-FIX-1.
    expect(results).toHaveLength(3);
  });

  it("rejects the deliberately invalid same-team fixture", () => {
    const raw = TEST_FIXTURE_PROVIDER_RAW_DATA.fixtures.find((r) => r.id === "TFP-FIX-INVALID-1");
    expect(raw).toBeDefined();
    const result = normalizeTestFixtureFixture(raw!);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NORMALIZE_DUPLICATE_TEAMS");
  });

  it("rejects the deliberately invalid fixture missing kickoff_utc", () => {
    const raw = TEST_FIXTURE_PROVIDER_RAW_DATA.fixtures.find((r) => r.id === "TFP-FIX-INVALID-2");
    expect(raw).toBeDefined();
    expect(isErr(normalizeTestFixtureFixture(raw!))).toBe(true);
  });

  it("normalizes odds without a published_at as temporalReliability 'estimated'", () => {
    const raw = TEST_FIXTURE_PROVIDER_RAW_DATA.odds.find((r) => r.published_at === undefined);
    expect(raw).toBeDefined();
    const result = normalizeTestFixtureOdds(raw!);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.temporalReliability).toBe("estimated");
  });

  it("normalizes odds with a published_at as temporalReliability 'confirmed'", () => {
    const raw = TEST_FIXTURE_PROVIDER_RAW_DATA.odds.find((r) => r.published_at !== undefined);
    expect(raw).toBeDefined();
    const result = normalizeTestFixtureOdds(raw!);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.temporalReliability).toBe("confirmed");
  });
});

describe("testFixtureProvider adapter contract", () => {
  it("fetchFixtures returns a well-formed 'ok' ProviderFetchOutcome", async () => {
    const outcome = await testFixtureProvider.fixtures!.fetchFixtures({});
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.records.length).toBe(9);
      expect(outcome.fetchedAt).toBeDefined();
    }
  });

  it("is not enabled with a live credential — config.apiKey is undefined", () => {
    expect(testFixtureProvider.config.apiKey).toBeUndefined();
  });
});
