import type { Pick } from "@tipstar/types";
import { calculatePerformanceStats, type PerformanceStats } from "./stats.js";

export type TimeGranularity = "daily" | "weekly" | "monthly";

function bucketKey(publishedAt: string, granularity: TimeGranularity): string {
  const date = new Date(publishedAt);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  switch (granularity) {
    case "daily":
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    case "monthly":
      return `${year}-${String(month + 1).padStart(2, "0")}`;
    case "weekly": {
      // ISO week number.
      const target = new Date(Date.UTC(year, month, day));
      const dayNumber = (target.getUTCDay() + 6) % 7;
      target.setUTCDate(target.getUTCDate() - dayNumber + 3);
      const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
      const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
  }
}

export function performanceOverTime(
  picks: readonly Pick[],
  granularity: TimeGranularity,
): readonly { readonly period: string; readonly stats: PerformanceStats }[] {
  const buckets = new Map<string, Pick[]>();
  for (const pick of picks) {
    const key = bucketKey(pick.publishedAt, granularity);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(pick);
    } else {
      buckets.set(key, [pick]);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, bucketPicks]) => ({ period, stats: calculatePerformanceStats(bucketPicks) }));
}
