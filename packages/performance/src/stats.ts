import { FinalResult, type Pick } from "@tipstar/types";

export interface StreakInfo {
  readonly type: "win" | "loss" | "none";
  readonly count: number;
}

export interface PerformanceStats {
  readonly totalPicks: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly pushes: number;
  readonly pending: number;
  readonly winRate: number | null;
  readonly averageOdds: number | null;
  readonly profitLossUnits: number;
  readonly roi: number | null;
  readonly currentStreak: StreakInfo;
  readonly longestWinningStreak: number;
  readonly longestLosingStreak: number;
}

/**
 * Derives performance statistics purely from settled Pick records — never
 * from manually entered numbers (Section 15). Assumes a flat 1-unit stake
 * per pick for profit/loss and ROI, since Tipstar never takes custody of
 * user funds or stake sizing.
 *
 * Every pick is counted, including losses and voids (Section 14,
 * "No Hidden Losses") — this function never filters out unfavorable results.
 */
export function calculatePerformanceStats(picks: readonly Pick[]): PerformanceStats {
  const totalPicks = picks.length;
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let pushes = 0;
  let pending = 0;
  let oddsSum = 0;
  let oddsCount = 0;
  let profitLossUnits = 0;
  let stakedUnits = 0;

  let currentStreakType: "win" | "loss" | "none" = "none";
  let currentStreakCount = 0;
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;
  let runningWinStreak = 0;
  let runningLossStreak = 0;

  const settledInOrder = [...picks]
    .filter((p) => p.finalResult !== FinalResult.PENDING)
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

  for (const pick of picks) {
    switch (pick.finalResult) {
      case FinalResult.WIN:
        wins += 1;
        break;
      case FinalResult.LOSS:
        losses += 1;
        break;
      case FinalResult.VOID:
        voids += 1;
        break;
      case FinalResult.PUSH:
        pushes += 1;
        break;
      case FinalResult.PENDING:
        pending += 1;
        break;
    }
    if (pick.oddsAtPublication !== null) {
      oddsSum += pick.oddsAtPublication;
      oddsCount += 1;
    }
  }

  for (const pick of settledInOrder) {
    if (pick.finalResult === FinalResult.WIN) {
      stakedUnits += 1;
      profitLossUnits += pick.oddsAtPublication !== null ? pick.oddsAtPublication - 1 : 0;
      runningWinStreak += 1;
      runningLossStreak = 0;
    } else if (pick.finalResult === FinalResult.LOSS) {
      stakedUnits += 1;
      profitLossUnits -= 1;
      runningLossStreak += 1;
      runningWinStreak = 0;
    } else {
      // void/push: stake returned, no streak impact.
      runningWinStreak = 0;
      runningLossStreak = 0;
    }
    longestWinningStreak = Math.max(longestWinningStreak, runningWinStreak);
    longestLosingStreak = Math.max(longestLosingStreak, runningLossStreak);
  }

  if (runningWinStreak > 0) {
    currentStreakType = "win";
    currentStreakCount = runningWinStreak;
  } else if (runningLossStreak > 0) {
    currentStreakType = "loss";
    currentStreakCount = runningLossStreak;
  }

  const decidedCount = wins + losses;

  return {
    totalPicks,
    wins,
    losses,
    voids,
    pushes,
    pending,
    winRate: decidedCount > 0 ? wins / decidedCount : null,
    averageOdds: oddsCount > 0 ? oddsSum / oddsCount : null,
    profitLossUnits: Number(profitLossUnits.toFixed(4)),
    roi: stakedUnits > 0 ? Number((profitLossUnits / stakedUnits).toFixed(4)) : null,
    currentStreak: { type: currentStreakType, count: currentStreakCount },
    longestWinningStreak,
    longestLosingStreak,
  };
}
