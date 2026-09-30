import { MarketType } from "@sport-os/market-engine";
import { LedgerMode, PayoutSource, SettlementStatus, type Money } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import { createTicketDraft, TicketStatus, transitionTicketStatus, type TicketLeg, type TicketRecord } from "./ticket-engine.js";
import { settleLeg, settleMarket, settleTicket, settleTicketLegs, type FootballResultSnapshot } from "./settlement.js";

const NOW = "2026-02-01T21:00:00Z";
const FIXTURE_A = "11111111-1111-1111-1111-111111111111";
const FIXTURE_B = "22222222-2222-2222-2222-222222222222";

function result(overrides: Partial<FootballResultSnapshot> = {}): FootballResultSnapshot {
  return { resultVersionId: "result-v1", homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0, ...overrides };
}

function leg(overrides: Partial<TicketLeg> = {}): TicketLeg {
  return {
    legId: "leg-1",
    fixtureId: FIXTURE_A,
    marketType: MarketType.MATCH_RESULT_1X2,
    selection: "HOME",
    line: undefined,
    probability: 0.6,
    odds: 2.0,
    fairOdds: 1 / 0.6,
    expectedValue: 0.2,
    edge: 0.1,
    modelVersion: "model-v1",
    calculationVersion: "value-engine-v1",
    valueEvaluatedAt: NOW,
    leakageFlag: false,
    ...overrides,
  };
}

describe("settleMarket — 1X2", () => {
  it("HOME wins when home goals exceed away goals", () => {
    expect(settleMarket(MarketType.MATCH_RESULT_1X2, "HOME", undefined, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("AWAY selection loses when home wins", () => {
    expect(settleMarket(MarketType.MATCH_RESULT_1X2, "AWAY", undefined, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.LOST);
  });
  it("DRAW wins on an equal score", () => {
    expect(settleMarket(MarketType.MATCH_RESULT_1X2, "DRAW", undefined, result({ homeGoals: 1, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("returns PENDING (never guessed) when no result is available yet", () => {
    expect(settleMarket(MarketType.MATCH_RESULT_1X2, "HOME", undefined, undefined).status).toBe(SettlementStatus.PENDING);
  });
});

describe("settleMarket — Double Chance", () => {
  it("1X wins on a home win", () => {
    expect(settleMarket(MarketType.DOUBLE_CHANCE, "1X", undefined, result({ homeGoals: 2, awayGoals: 0 })).status).toBe(SettlementStatus.WON);
  });
  it("1X wins on a draw", () => {
    expect(settleMarket(MarketType.DOUBLE_CHANCE, "1X", undefined, result({ homeGoals: 1, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("1X loses on an away win", () => {
    expect(settleMarket(MarketType.DOUBLE_CHANCE, "1X", undefined, result({ homeGoals: 0, awayGoals: 2 })).status).toBe(SettlementStatus.LOST);
  });
});

describe("settleMarket — BTTS", () => {
  it("YES wins when both teams score", () => {
    expect(settleMarket(MarketType.BOTH_TEAMS_TO_SCORE, "YES", undefined, result({ homeGoals: 1, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("NO wins when at least one team fails to score", () => {
    expect(settleMarket(MarketType.BOTH_TEAMS_TO_SCORE, "NO", undefined, result({ homeGoals: 2, awayGoals: 0 })).status).toBe(SettlementStatus.WON);
  });
});

describe("settleMarket — Over/Under", () => {
  it("OVER wins when total goals exceed the line", () => {
    expect(settleMarket(MarketType.OVER_UNDER, "OVER", 2.5, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("UNDER wins when total goals are below the line", () => {
    expect(settleMarket(MarketType.OVER_UNDER, "UNDER", 3.5, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("pushes (stake returned) when total goals exactly equal a whole-number line", () => {
    const outcome = settleMarket(MarketType.OVER_UNDER, "OVER", 3, result({ homeGoals: 2, awayGoals: 1 }));
    expect(outcome.status).toBe(SettlementStatus.PUSH);
  });
  it("returns PENDING when no line is supplied", () => {
    expect(settleMarket(MarketType.OVER_UNDER, "OVER", undefined, result()).status).toBe(SettlementStatus.PENDING);
  });
});

describe("settleMarket — Correct Score", () => {
  it("wins on an exact match", () => {
    expect(settleMarket(MarketType.CORRECT_SCORE, "2-1", undefined, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("loses on any other final score", () => {
    expect(settleMarket(MarketType.CORRECT_SCORE, "2-0", undefined, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.LOST);
  });
});

describe("settleMarket — European Handicap", () => {
  it("HOME -1 wins when home wins by more than one goal", () => {
    expect(settleMarket(MarketType.EUROPEAN_HANDICAP, "HOME", -1, result({ homeGoals: 3, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
  it("HOME -1 resolves to DRAW (loses) when home wins by exactly one goal", () => {
    const outcome = settleMarket(MarketType.EUROPEAN_HANDICAP, "HOME", -1, result({ homeGoals: 2, awayGoals: 1 }));
    expect(outcome.status).toBe(SettlementStatus.LOST);
  });
  it("DRAW +0 wins on an equal handicap-adjusted score — never a push (three-way handicap)", () => {
    expect(settleMarket(MarketType.EUROPEAN_HANDICAP, "DRAW", -1, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.WON);
  });
});

describe("settleMarket — Asian Handicap", () => {
  it("HOME -0.5 wins on any home win (no push possible on a half line)", () => {
    expect(settleMarket(MarketType.ASIAN_HANDICAP, "HOME", -0.5, result({ homeGoals: 1, awayGoals: 0 })).status).toBe(SettlementStatus.WON);
  });
  it("HOME -1 pushes (stake returned) on a one-goal home win", () => {
    expect(settleMarket(MarketType.ASIAN_HANDICAP, "HOME", -1, result({ homeGoals: 2, awayGoals: 1 })).status).toBe(SettlementStatus.PUSH);
  });
  it("AWAY +1 loses when home wins by more than one goal", () => {
    expect(settleMarket(MarketType.ASIAN_HANDICAP, "AWAY", 1, result({ homeGoals: 3, awayGoals: 1 })).status).toBe(SettlementStatus.LOST);
  });
  it("a quarter line (e.g. -0.25) is PENDING — split-stake settlement is not implemented, never guessed", () => {
    expect(settleMarket(MarketType.ASIAN_HANDICAP, "HOME", -0.25, result({ homeGoals: 1, awayGoals: 0 })).status).toBe(SettlementStatus.PENDING);
  });
});

describe("settleMarket — First Half / Second Half", () => {
  it("grades First Half from the halftime score, not the full-time score", () => {
    // halftime 1-0 (home leads), full-time 2-1 — FIRST_HALF HOME must use halftime only.
    expect(settleMarket(MarketType.FIRST_HALF, "HOME", undefined, result({ homeGoals: 2, awayGoals: 1, halftimeHomeGoals: 1, halftimeAwayGoals: 0 })).status).toBe(SettlementStatus.WON);
  });
  it("grades Second Half from (full-time - halftime), not the full-time score directly", () => {
    // halftime 1-0, full-time 1-2 -> second half score is 0-2 (away scored twice in the second half).
    const outcome = settleMarket(MarketType.SECOND_HALF, "AWAY", undefined, result({ homeGoals: 1, awayGoals: 2, halftimeHomeGoals: 1, halftimeAwayGoals: 0 }));
    expect(outcome.status).toBe(SettlementStatus.WON);
  });
  it("returns PENDING when halftime data is unavailable", () => {
    expect(settleMarket(MarketType.FIRST_HALF, "HOME", undefined, result({ halftimeHomeGoals: undefined, halftimeAwayGoals: undefined })).status).toBe(SettlementStatus.PENDING);
    expect(settleMarket(MarketType.SECOND_HALF, "HOME", undefined, result({ halftimeHomeGoals: undefined, halftimeAwayGoals: undefined })).status).toBe(SettlementStatus.PENDING);
  });
});

describe("settleMarket — Team Totals / Corners / Cards", () => {
  it("always returns PENDING — no canonical result data exists for these markets yet", () => {
    expect(settleMarket(MarketType.TEAM_TOTALS, "HOME_OVER", 1.5, result()).status).toBe(SettlementStatus.PENDING);
    expect(settleMarket(MarketType.CORNERS, "OVER", 9.5, result()).status).toBe(SettlementStatus.PENDING);
    expect(settleMarket(MarketType.CARDS, "OVER", 3.5, result()).status).toBe(SettlementStatus.PENDING);
  });
});

describe("settleLeg", () => {
  it("carries the leg's own fixture/market/selection/odds through to the settlement record", () => {
    const settled = settleLeg(leg({ selection: "HOME", odds: 2.5 }), result({ homeGoals: 1, awayGoals: 0 }));
    expect(settled.status).toBe(SettlementStatus.WON);
    expect(settled.odds).toBe(2.5);
    expect(settled.resultVersionId).toBe("result-v1");
  });

  it("resultVersionId is undefined when no result exists — never a fabricated reference", () => {
    const settled = settleLeg(leg(), undefined);
    expect(settled.status).toBe(SettlementStatus.PENDING);
    expect(settled.resultVersionId).toBeUndefined();
  });
});

describe("settleTicketLegs — accumulator aggregation (§13)", () => {
  it("a single WON leg resolves the ticket to WON with that leg's own odds as the multiplier", () => {
    const result1 = settleTicketLegs([settleLeg(leg({ odds: 2.2 }), result({ homeGoals: 1, awayGoals: 0 }))]);
    expect(result1.status).toBe(SettlementStatus.WON);
    expect(result1.combinedMultiplier).toBeCloseTo(2.2, 6);
  });

  it("any LOST leg resolves the whole ticket to LOST, even with another leg still PENDING", () => {
    const lostLeg = settleLeg(leg({ legId: "l1", selection: "AWAY" }), result({ homeGoals: 2, awayGoals: 0 }));
    const pendingLeg = settleLeg(leg({ legId: "l2", fixtureId: FIXTURE_B }), undefined);
    expect(settleTicketLegs([lostLeg, pendingLeg]).status).toBe(SettlementStatus.LOST);
  });

  it("any PENDING leg (with no LOST leg) keeps the ticket PENDING", () => {
    const wonLeg = settleLeg(leg({ legId: "l1" }), result({ homeGoals: 1, awayGoals: 0 }));
    const pendingLeg = settleLeg(leg({ legId: "l2", fixtureId: FIXTURE_B }), undefined);
    expect(settleTicketLegs([wonLeg, pendingLeg]).status).toBe(SettlementStatus.PENDING);
  });

  it("a 5-leg accumulator with all legs WON resolves to WON with the product of all 5 odds", () => {
    const legs = Array.from({ length: 5 }, (_, i) => settleLeg(leg({ legId: `l${i}`, fixtureId: `fixture-${i}`, odds: 2 }), result({ homeGoals: 1, awayGoals: 0 })));
    const aggregation = settleTicketLegs(legs);
    expect(aggregation.status).toBe(SettlementStatus.WON);
    expect(aggregation.combinedMultiplier).toBeCloseTo(32, 6); // 2^5
  });

  it("a genuine SINGLE that pushes stays PUSH — never collapsed to VOID", () => {
    const pushLeg = settleLeg(leg({ legId: "l1", marketType: MarketType.OVER_UNDER, selection: "OVER", line: 3 }), result({ homeGoals: 2, awayGoals: 1 }));
    const aggregation = settleTicketLegs([pushLeg]);
    expect(aggregation.status).toBe(SettlementStatus.PUSH);
    expect(aggregation.combinedMultiplier).toBe(1);
  });

  it("a multi-leg accumulator where every leg is VOID/PUSH resolves the ticket to VOID (stake returned), never WON — a documented, versioned convention distinct from a genuine single push", () => {
    const pushLeg1 = settleLeg(leg({ legId: "l1", marketType: MarketType.OVER_UNDER, selection: "OVER", line: 3 }), result({ homeGoals: 2, awayGoals: 1 }));
    const pushLeg2 = settleLeg(leg({ legId: "l2", fixtureId: FIXTURE_B, marketType: MarketType.ASIAN_HANDICAP, selection: "HOME", line: -1 }), result({ homeGoals: 2, awayGoals: 1 }));
    const aggregation = settleTicketLegs([pushLeg1, pushLeg2]);
    expect(aggregation.status).toBe(SettlementStatus.VOID);
    expect(aggregation.combinedMultiplier).toBe(1);
  });

  it("a WON leg plus a VOID/PUSH leg still resolves WON, with the void leg contributing a neutral 1.0 multiplier", () => {
    const wonLeg = settleLeg(leg({ legId: "l1", odds: 3 }), result({ homeGoals: 1, awayGoals: 0 }));
    const voidLeg = settleLeg(leg({ legId: "l2", fixtureId: FIXTURE_B, marketType: MarketType.OVER_UNDER, selection: "OVER", line: 3, odds: 5 }), result({ homeGoals: 2, awayGoals: 1 }));
    const aggregation = settleTicketLegs([wonLeg, voidLeg]);
    expect(aggregation.status).toBe(SettlementStatus.WON);
    expect(aggregation.combinedMultiplier).toBeCloseTo(3, 6); // 3 * 1.0, not 3 * 5
  });
});

function ticketWith(legs: readonly TicketLeg[], overrides: Partial<TicketRecord> = {}): TicketRecord {
  const draft = createTicketDraft({ legs, createdBy: "user-1", now: () => NOW });
  return { ...draft, ...overrides };
}

describe("settleTicket — full ticket settlement, analytical vs financial (§42)", () => {
  it("settles a ticket's analytical outcome even when it was never executed — actual financial fields all null", () => {
    const ticket = ticketWith([leg({ odds: 2.0 })]);
    const settled = settleTicket({ ticket, results: new Map([[FIXTURE_A, result({ homeGoals: 1, awayGoals: 0 })]]), execution: undefined, ledgerMode: LedgerMode.PAPER, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.WON);
    expect(settled.actualStake).toBeNull();
    expect(settled.actualPayout).toBeNull();
    expect(settled.netPnl).toBeNull();
    expect(settled.roi).toBeNull();
    expect(settled.calculatedReturn).toBeNull();
  });

  it("a CANCELLED ticket settles directly to CANCELLED without grading any legs", () => {
    const ticket = ticketWith([leg()], { status: TicketStatus.CANCELLED });
    const settled = settleTicket({ ticket, results: new Map(), execution: undefined, ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.CANCELLED);
    expect(settled.legs).toHaveLength(0);
  });

  it("an executed WON single with a real PROVIDER payout computes real actual net P&L and ROI", () => {
    const ticket = ticketWith([leg({ odds: 2.0 })]);
    const stake: Money = { amount: 100, currency: "NGN" };
    const payout: Money = { amount: 200, currency: "NGN" };
    const settled = settleTicket({
      ticket,
      results: new Map([[FIXTURE_A, result({ homeGoals: 1, awayGoals: 0 })]]),
      execution: { stake, payout, payoutSource: PayoutSource.PROVIDER },
      ledgerMode: LedgerMode.LIVE,
      source: "test",
      now: NOW,
    });
    expect(settled.status).toBe(SettlementStatus.WON);
    expect(settled.actualStake).toEqual(stake);
    expect(settled.actualPayout).toEqual(payout);
    expect(settled.payoutSource).toBe(PayoutSource.PROVIDER);
    expect(settled.netPnl).toEqual({ amount: 100, currency: "NGN" });
    expect(settled.roi).toBeCloseTo(1.0, 6);
  });

  it("an executed WON single with only a real stake (no provider payout) gets a CALCULATED_RETURN, but actualPayout/netPnl/roi remain null", () => {
    const ticket = ticketWith([leg({ odds: 2.0 })]);
    const stake: Money = { amount: 100, currency: "NGN" };
    const settled = settleTicket({
      ticket,
      results: new Map([[FIXTURE_A, result({ homeGoals: 1, awayGoals: 0 })]]),
      execution: { stake, payout: undefined, payoutSource: PayoutSource.CALCULATED },
      ledgerMode: LedgerMode.LIVE,
      source: "test",
      now: NOW,
    });
    expect(settled.status).toBe(SettlementStatus.WON);
    expect(settled.actualStake).toEqual(stake);
    expect(settled.actualPayout).toBeNull();
    expect(settled.payoutSource).toBe(PayoutSource.CALCULATED);
    expect(settled.calculatedReturn).toEqual({ amount: 200, currency: "NGN" });
    expect(settled.netPnl).toBeNull();
    expect(settled.roi).toBeNull();
  });

  it("an executed LOST single's calculatedReturn is 0, never a fabricated partial return", () => {
    const ticket = ticketWith([leg({ odds: 2.0, selection: "AWAY" })]);
    const stake: Money = { amount: 100, currency: "NGN" };
    const settled = settleTicket({
      ticket,
      results: new Map([[FIXTURE_A, result({ homeGoals: 2, awayGoals: 0 })]]),
      execution: { stake, payout: undefined, payoutSource: PayoutSource.CALCULATED },
      ledgerMode: LedgerMode.LIVE,
      source: "test",
      now: NOW,
    });
    expect(settled.status).toBe(SettlementStatus.LOST);
    expect(settled.calculatedReturn).toEqual({ amount: 0, currency: "NGN" });
  });

  it("a PUSH ticket's calculatedReturn equals the stake — stake returned, not a fabricated profit", () => {
    const ticket = ticketWith([leg({ marketType: MarketType.OVER_UNDER, selection: "OVER", line: 3, odds: 1.9 })]);
    const stake: Money = { amount: 50, currency: "NGN" };
    const settled = settleTicket({
      ticket,
      results: new Map([[FIXTURE_A, result({ homeGoals: 2, awayGoals: 1 })]]),
      execution: { stake, payout: undefined, payoutSource: PayoutSource.CALCULATED },
      ledgerMode: LedgerMode.LIVE,
      source: "test",
      now: NOW,
    });
    expect(settled.status).toBe(SettlementStatus.PUSH);
    expect(settled.calculatedReturn).toEqual(stake);
  });

  it("a PENDING ticket (unresolved leg) never computes a calculatedReturn, even with a real stake", () => {
    const ticket = ticketWith([leg()]);
    const stake: Money = { amount: 100, currency: "NGN" };
    const settled = settleTicket({ ticket, results: new Map(), execution: { stake, payout: undefined, payoutSource: PayoutSource.CALCULATED }, ledgerMode: LedgerMode.LIVE, source: "test", now: NOW });
    expect(settled.status).toBe(SettlementStatus.PENDING);
    expect(settled.settledAt).toBeNull();
    expect(settled.calculatedReturn).toBeNull();
    expect(settled.actualStake).toEqual(stake);
  });

  it("stamps the ticket's own version and the settlement policy version onto every settlement", () => {
    const drafted = ticketWith([leg()]);
    const transitioned = transitionTicketStatus(drafted, TicketStatus.PROPOSED, NOW);
    const settled = settleTicket({ ticket: transitioned, results: new Map(), execution: undefined, ledgerMode: LedgerMode.PAPER, source: "test", now: NOW });
    expect(settled.ticketVersion).toBe(2);
    expect(settled.settlementPolicyVersion).toBe("football-settlement-v1");
  });
});
