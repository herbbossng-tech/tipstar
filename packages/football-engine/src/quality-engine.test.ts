import { describe, expect, it } from "vitest";
import { checkBatchUniqueness, checkFixtureQuality, checkMatchEventQuality, checkMatchResultQuality, checkOddsObservationQuality, type QualityCheckContext } from "./quality-engine.js";
import { QualityStatus } from "./quality-types.js";
import type { Fixture } from "./canonical.js";
import type { NormalizedFixture, NormalizedMatchEvent, NormalizedMatchResult, NormalizedOddsObservation } from "./normalize.js";

const CTX: QualityCheckContext = { now: "2026-01-10T18:00:00Z" };

function baseFixture(overrides: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    provider: "test",
    providerFixtureId: "FIX-1",
    providerCompetitionId: "COMP-1",
    providerSeasonId: "SEASON-1",
    providerHomeTeamId: "TEAM-1",
    providerAwayTeamId: "TEAM-2",
    scheduledKickoffAt: "2026-01-10T19:00:00Z",
    status: "scheduled",
    providerStatusRaw: "NS",
    ...overrides,
  };
}

const FIXTURE_ROW: Fixture = {
  id: "fixture-uuid",
  competitionId: "comp-uuid",
  seasonId: "season-uuid",
  homeTeamId: "home-uuid",
  awayTeamId: "away-uuid",
  scheduledKickoffAt: "2026-01-10T19:00:00Z",
  actualKickoffAt: undefined,
  status: "scheduled",
  providerStatusRaw: "NS",
  venueId: undefined,
  provider: "test",
  providerFixtureId: "FIX-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("checkFixtureQuality", () => {
  it("passes a well-formed fixture with VALID status and a perfect score", () => {
    const result = checkFixtureQuality(baseFixture(), CTX);
    expect(result.status).toBe(QualityStatus.VALID);
    expect(result.score).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("marks a fixture with identical home/away teams INVALID", () => {
    const result = checkFixtureQuality(baseFixture({ providerHomeTeamId: "TEAM-X", providerAwayTeamId: "TEAM-X" }), CTX);
    expect(result.status).toBe(QualityStatus.INVALID);
    expect(result.errors.some((e) => e.includes("distinct"))).toBe(true);
  });

  it("marks a fixture with an unparseable kickoff timestamp INVALID", () => {
    const result = checkFixtureQuality(baseFixture({ scheduledKickoffAt: "not-a-date" }), CTX);
    expect(result.status).toBe(QualityStatus.INVALID);
  });
});

describe("checkMatchResultQuality", () => {
  function baseResult(overrides: Partial<NormalizedMatchResult> = {}): NormalizedMatchResult {
    return {
      providerFixtureId: "FIX-1",
      homeGoals: 2,
      awayGoals: 1,
      halftimeHomeGoals: 1,
      halftimeAwayGoals: 0,
      resultRecordedAt: "2026-01-10T20:55:00Z",
      source: "test",
      ...overrides,
    };
  }

  it("passes a well-formed, sane result as VALID", () => {
    const result = checkMatchResultQuality(baseResult(), FIXTURE_ROW, { now: "2026-01-10T21:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID);
  });

  it("rejects negative goals as INVALID (defense in depth vs. the DB CHECK constraint)", () => {
    const result = checkMatchResultQuality(baseResult({ homeGoals: -1 }), FIXTURE_ROW, { now: "2026-01-10T21:00:00Z" });
    expect(result.status).toBe(QualityStatus.INVALID);
  });

  it("warns (not rejects) when halftime goals exceed fulltime goals", () => {
    const result = checkMatchResultQuality(baseResult({ halftimeHomeGoals: 5 }), FIXTURE_ROW, { now: "2026-01-10T21:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID_WITH_WARNINGS);
    expect(result.warnings.some((w) => w.includes("Halftime"))).toBe(true);
  });

  it("rejects a resultRecordedAt in the future relative to ctx.now", () => {
    const result = checkMatchResultQuality(baseResult({ resultRecordedAt: "2026-01-10T19:00:01Z" }), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.INVALID);
  });

  it("warns when a result claims to have been recorded before scheduled kickoff", () => {
    const result = checkMatchResultQuality(baseResult({ resultRecordedAt: "2026-01-10T10:00:00Z" }), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID_WITH_WARNINGS);
  });
});

describe("checkMatchEventQuality", () => {
  function baseEvent(overrides: Partial<NormalizedMatchEvent> = {}): NormalizedMatchEvent {
    return {
      provider: "test",
      providerEventId: "EVT-1",
      providerFixtureId: "FIX-1",
      eventType: "goal",
      providerEventType: "GOAL",
      providerTeamId: "TEAM-1",
      minute: 23,
      observedAt: "2026-01-10T19:23:00Z",
      ...overrides,
    };
  }

  it("passes a well-formed event as VALID", () => {
    const result = checkMatchEventQuality(baseEvent(), FIXTURE_ROW, { now: "2026-01-10T20:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID);
  });

  it("warns when the event minute is out of sane bounds", () => {
    const result = checkMatchEventQuality(baseEvent({ minute: 400 }), FIXTURE_ROW, { now: "2026-01-10T20:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID_WITH_WARNINGS);
  });

  it("rejects an observedAt in the future", () => {
    const result = checkMatchEventQuality(baseEvent({ observedAt: "2026-01-11T00:00:00Z" }), FIXTURE_ROW, { now: "2026-01-10T20:00:00Z" });
    expect(result.status).toBe(QualityStatus.INVALID);
  });
});

describe("checkOddsObservationQuality", () => {
  function baseOdds(overrides: Partial<NormalizedOddsObservation> = {}): NormalizedOddsObservation {
    return {
      provider: "test",
      providerObservationId: undefined,
      providerFixtureId: "FIX-1",
      marketType: "match_result_1x2",
      selection: "home",
      odds: 2.1,
      bookmakerSource: "test_bookmaker",
      observedAt: "2026-01-10T17:00:00Z",
      providerPublishedAt: "2026-01-10T16:55:00Z",
      temporalReliability: "confirmed",
      ...overrides,
    };
  }

  it("passes a well-formed, provider-confirmed odds observation as VALID", () => {
    const result = checkOddsObservationQuality(baseOdds(), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID);
  });

  it("rejects non-positive odds (defense in depth vs. the DB CHECK constraint)", () => {
    const result = checkOddsObservationQuality(baseOdds({ odds: 0 }), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.INVALID);
  });

  it("warns (never rejects) an estimated-reliability observation with no provider-published timestamp", () => {
    const result = checkOddsObservationQuality(baseOdds({ providerPublishedAt: undefined, temporalReliability: "estimated" }), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.VALID_WITH_WARNINGS);
    expect(result.warnings.some((w) => w.includes("estimated"))).toBe(true);
  });

  it("rejects an observedAt in the future", () => {
    const result = checkOddsObservationQuality(baseOdds({ observedAt: "2026-01-10T19:00:00Z" }), FIXTURE_ROW, { now: "2026-01-10T18:00:00Z" });
    expect(result.status).toBe(QualityStatus.INVALID);
  });
});

describe("checkBatchUniqueness", () => {
  it("passes (with a warning-severity result) when every key in the batch is unique", () => {
    const result = checkBatchUniqueness(["A", "B", "C"], (x) => x, "widget");
    expect(result.status).toBe(QualityStatus.VALID);
  });

  it("flags duplicate keys without failing the batch outright", () => {
    const result = checkBatchUniqueness(["A", "B", "A"], (x) => x, "widget");
    expect(result.status).toBe(QualityStatus.VALID_WITH_WARNINGS);
    expect(result.warnings[0]).toContain("A");
  });

  it("ignores records with no key (nothing to compare)", () => {
    const result = checkBatchUniqueness([{ id: undefined }, { id: undefined }], (x) => x.id, "widget");
    expect(result.status).toBe(QualityStatus.VALID);
  });
});
