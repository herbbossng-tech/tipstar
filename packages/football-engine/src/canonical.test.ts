import { describe, expect, it } from "vitest";
import { MatchStatus, normalizeCommonMatchStatus } from "./canonical.js";

describe("normalizeCommonMatchStatus", () => {
  it.each([
    ["NS", MatchStatus.SCHEDULED],
    ["TIMED", MatchStatus.TIMED],
    ["1H", MatchStatus.LIVE],
    ["2H", MatchStatus.LIVE],
    ["LIVE", MatchStatus.LIVE],
    ["IN_PLAY", MatchStatus.LIVE],
    ["HT", MatchStatus.HALFTIME],
    ["FT", MatchStatus.FINISHED],
    ["AET", MatchStatus.FINISHED],
    ["PEN", MatchStatus.FINISHED],
    ["PST", MatchStatus.POSTPONED],
    ["CANC", MatchStatus.CANCELLED],
    ["AWD", MatchStatus.ABANDONED],
    ["SUSP", MatchStatus.SUSPENDED],
  ])("maps %s to %s", (raw, expected) => {
    expect(normalizeCommonMatchStatus(raw)).toBe(expected);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeCommonMatchStatus(" ft ")).toBe(MatchStatus.FINISHED);
  });

  it("maps an unrecognized code to UNKNOWN rather than guessing", () => {
    expect(normalizeCommonMatchStatus("SOME_NEW_PROVIDER_CODE")).toBe(MatchStatus.UNKNOWN);
  });
});
