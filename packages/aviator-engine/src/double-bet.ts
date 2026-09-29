import type { ISODateString } from "@sport-os/shared";

/**
 * "Double bet" boundary (Section 01 — Aviator Engine Boundary; locked in
 * Section 06 — Agent Framework). Section 01 left the precise semantics as
 * a genuine open question (docs/architecture/OPEN_QUESTIONS.md #1,
 * between "two concurrent stakes at different cash-out targets" and "a
 * martingale-style stake progression"); Section 06's own spec resolves
 * it: a double bet is two independent, concurrent targets on the same
 * round — Target 1 and Target 2 — never a martingale progression. See
 * `DoubleBetRecord` below for the locked, concrete shape; `DoubleBetPlan`/
 * `DoubleBetStrategy` remain as Section 01 left them (a strategy that
 * decides WHEN to place a double bet and at what two targets), now
 * producing a `DoubleBetRecord` once the round settles.
 */
export interface DoubleBetPlan {
  readonly signalId: string;
  readonly legs: readonly { readonly cashOutMultiplier: number; readonly stakeWeight: number }[];
}

export interface DoubleBetStrategy {
  plan(signalId: string): Promise<DoubleBetPlan | undefined>;
}

/** The two, and only two, targets a double bet ever holds — never a variable-length list, never a progression across rounds. */
export const DoubleBetTargetId = { TARGET_1: "target_1", TARGET_2: "target_2" } as const;
export type DoubleBetTargetId = (typeof DoubleBetTargetId)[keyof typeof DoubleBetTargetId];

/** The default, locked stake split between Target 1 and Target 2 — see `DoubleBetRecord`'s doc comment: "No Martingale by default. Do not allow an agent to silently change this." A caller may still construct a `DoubleBetLeg` with an explicit non-50/50 `stakeWeight` (e.g. an admin-configured override), but nothing in this codebase ever does so without an explicit, non-default value supplied. */
export const DEFAULT_DOUBLE_BET_STAKE_WEIGHT = 0.5;

/**
 * One leg of a double bet — each target independently tracks its own
 * stake, cash-out, actual exit, and resulting P&L. Two legs never share
 * a mutable object; correcting or settling one leg must never touch the
 * other's already-recorded fields.
 */
export interface DoubleBetLeg {
  readonly target: DoubleBetTargetId;
  /** This leg's own cash-out target multiplier — independent of the other leg's. */
  readonly targetMultiplier: number;
  /** This leg's share of the combined stake — `DEFAULT_DOUBLE_BET_STAKE_WEIGHT` (0.5) unless the caller explicitly overrides it; the two legs' weights are not required to sum to 1 by this type (a caller could deliberately under- or over-allocate), but every default-constructed double bet in this codebase uses an exact 50/50 split — see `buildDefaultDoubleBetLegs`. */
  readonly stakeWeight: number;
  readonly stake: number;
  /** The multiplier this leg actually cashed out at — undefined until the round resolves this leg (it crashed before the target, or the leg was cashed out early/late relative to `targetMultiplier`). Never fabricated ahead of the real round outcome. */
  readonly actualExitMultiplier: number | undefined;
  /** stake * actualExitMultiplier when known, minus stake — undefined until actualExitMultiplier is known. A round that crashed before this leg's target is a real, valid outcome (return = 0, pnl = -stake), never treated as "unknown." */
  readonly return: number | undefined;
  readonly pnl: number | undefined;
  readonly settledAt: ISODateString | undefined;
}

/**
 * The combined double bet record: two independent `DoubleBetLeg`s plus
 * the aggregate figures derived from them once both are known. "Default
 * split 50/50. No Martingale by default. Do not allow an agent to
 * silently change this." — nothing in `@sport-os/agents`' Aviator
 * Automation Agent constructs a `DoubleBetRecord` with a non-default
 * split or a stake derived from a prior round's outcome; see that
 * agent's own doc comment for the enforcement.
 */
export interface DoubleBetRecord {
  readonly doubleBetId: string;
  readonly signalId: string;
  readonly roundId: string;
  readonly target1: DoubleBetLeg;
  readonly target2: DoubleBetLeg;
  readonly totalStake: number;
  /** Undefined until both legs have settled. */
  readonly totalReturn: number | undefined;
  readonly netPnl: number | undefined;
  /** netPnl / totalStake, undefined until settled or if totalStake is 0. */
  readonly roi: number | undefined;
  readonly createdAt: ISODateString;
}

export interface BuildDoubleBetLegsParams {
  readonly totalStake: number;
  readonly target1Multiplier: number;
  readonly target2Multiplier: number;
  /** Target 1's share of `totalStake` — defaults to `DEFAULT_DOUBLE_BET_STAKE_WEIGHT` (50/50). Target 2 always receives the remainder, so the two legs' stakes sum to exactly `totalStake` by construction — never independently rounded in a way that could drift from it. */
  readonly target1StakeWeight?: number;
}

/** Constructs the two legs of a fresh, unsettled double bet — the one place `stakeWeight`/`stake` are derived, so "50/50 by default" is enforced by this function's default parameter, not by convention at each call site. */
export function buildDefaultDoubleBetLegs(params: BuildDoubleBetLegsParams): { readonly target1: DoubleBetLeg; readonly target2: DoubleBetLeg } {
  const target1StakeWeight = params.target1StakeWeight ?? DEFAULT_DOUBLE_BET_STAKE_WEIGHT;
  const target1Stake = params.totalStake * target1StakeWeight;
  const target2Stake = params.totalStake - target1Stake;
  return {
    target1: { target: DoubleBetTargetId.TARGET_1, targetMultiplier: params.target1Multiplier, stakeWeight: target1StakeWeight, stake: target1Stake, actualExitMultiplier: undefined, return: undefined, pnl: undefined, settledAt: undefined },
    target2: { target: DoubleBetTargetId.TARGET_2, targetMultiplier: params.target2Multiplier, stakeWeight: 1 - target1StakeWeight, stake: target2Stake, actualExitMultiplier: undefined, return: undefined, pnl: undefined, settledAt: undefined },
  };
}

/** Settles one leg against its real actual exit multiplier — never fabricates a value ahead of the real round outcome. `actualExitMultiplier` of `null` means the round crashed before this leg cashed out at all (a real, valid, zero-return outcome). */
export function settleDoubleBetLeg(leg: DoubleBetLeg, actualExitMultiplier: number | null, settledAt: ISODateString): DoubleBetLeg {
  const exit = actualExitMultiplier ?? 0;
  const legReturn = leg.stake * exit;
  return { ...leg, actualExitMultiplier: actualExitMultiplier ?? 0, return: legReturn, pnl: legReturn - leg.stake, settledAt };
}

/** Combines two (possibly still-unsettled) legs into the aggregate record fields — `totalReturn`/`netPnl`/`roi` stay undefined until BOTH legs report a `return`, since a partial settlement is not a real combined outcome yet. */
export function combineDoubleBetLegs(target1: DoubleBetLeg, target2: DoubleBetLeg): Pick<DoubleBetRecord, "totalStake" | "totalReturn" | "netPnl" | "roi"> {
  const totalStake = target1.stake + target2.stake;
  if (target1.return === undefined || target2.return === undefined) {
    return { totalStake, totalReturn: undefined, netPnl: undefined, roi: undefined };
  }
  const totalReturn = target1.return + target2.return;
  const netPnl = totalReturn - totalStake;
  return { totalStake, totalReturn, netPnl, roi: totalStake > 0 ? netPnl / totalStake : undefined };
}
