import { describe, expect, it } from "vitest";
import { buildDefaultDoubleBetLegs, combineDoubleBetLegs, DEFAULT_DOUBLE_BET_STAKE_WEIGHT, settleDoubleBetLeg } from "./double-bet.js";

describe("double-bet.ts — the locked Double Bet model", () => {
  it("defaults to an exact 50/50 stake split with no Martingale progression involved", () => {
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    expect(target1.stakeWeight).toBe(DEFAULT_DOUBLE_BET_STAKE_WEIGHT);
    expect(target2.stakeWeight).toBe(DEFAULT_DOUBLE_BET_STAKE_WEIGHT);
    expect(target1.stake).toBe(50);
    expect(target2.stake).toBe(50);
    expect(target1.stake + target2.stake).toBe(100);
  });

  it("the two legs' targets never move relative to each other — no stake progression across settlement", () => {
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    expect(target1.targetMultiplier).toBe(1.5);
    expect(target2.targetMultiplier).toBe(3.0);
    const settled = settleDoubleBetLeg(target1, 1.5, "2026-01-01T00:00:00Z");
    // Settling one leg never mutates the other, and never changes the settled leg's own target.
    expect(settled.targetMultiplier).toBe(1.5);
    expect(target2.actualExitMultiplier).toBeUndefined();
  });

  it("an explicit non-default split is honored, but the two stakes still sum to exactly totalStake", () => {
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0, target1StakeWeight: 0.7 });
    expect(target1.stakeWeight).toBe(0.7);
    expect(target2.stakeWeight).toBeCloseTo(0.3);
    expect(target1.stake).toBe(70);
    expect(target1.stake + target2.stake).toBe(100);
  });

  it("settling a leg at its exact target multiplier produces the expected return and pnl", () => {
    const { target1 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    const settled = settleDoubleBetLeg(target1, 1.5, "2026-01-01T00:00:00Z");
    expect(settled.return).toBe(75); // 50 stake * 1.5
    expect(settled.pnl).toBe(25); // 75 - 50
    expect(settled.settledAt).toBe("2026-01-01T00:00:00Z");
  });

  it("a leg that crashed before cashing out settles as a real zero-return loss, never a fabricated value", () => {
    const { target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    const settled = settleDoubleBetLeg(target2, null, "2026-01-01T00:00:00Z");
    expect(settled.actualExitMultiplier).toBe(0);
    expect(settled.return).toBe(0);
    expect(settled.pnl).toBe(-50);
  });

  it("combineDoubleBetLegs reports totals only once BOTH legs have settled — never a partial combined outcome", () => {
    const { target1, target2 } = buildDefaultDoubleBetLegs({ totalStake: 100, target1Multiplier: 1.5, target2Multiplier: 3.0 });
    const onlyOneSettled = settleDoubleBetLeg(target1, 1.5, "2026-01-01T00:00:00Z");
    const partial = combineDoubleBetLegs(onlyOneSettled, target2);
    expect(partial.totalReturn).toBeUndefined();
    expect(partial.netPnl).toBeUndefined();
    expect(partial.roi).toBeUndefined();

    const bothSettled = settleDoubleBetLeg(target2, 3.0, "2026-01-01T00:00:01Z");
    const complete = combineDoubleBetLegs(onlyOneSettled, bothSettled);
    expect(complete.totalReturn).toBe(75 + 150); // 50*1.5 + 50*3.0
    expect(complete.netPnl).toBe(225 - 100);
    expect(complete.roi).toBeCloseTo(1.25);
  });
});
