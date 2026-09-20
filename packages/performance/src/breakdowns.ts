import type { AgentType, MarketType, Pick, Sport, UUID } from "@tipstar/types";
import { calculatePerformanceStats, type PerformanceStats } from "./stats.js";

function groupBy<T, K extends string>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function toBreakdown<K extends string>(grouped: Map<K, Pick[]>): Record<K, PerformanceStats> {
  const result = {} as Record<K, PerformanceStats>;
  for (const [key, picks] of grouped) {
    result[key] = calculatePerformanceStats(picks);
  }
  return result;
}

export function performanceBySport(picks: readonly Pick[]): Record<Sport, PerformanceStats> {
  return toBreakdown(groupBy(picks, (p) => p.sport));
}

export function performanceByAgent(picks: readonly Pick[]): Record<AgentType, PerformanceStats> {
  return toBreakdown(groupBy(picks, (p) => p.agentType));
}

export function performanceByMarket(picks: readonly Pick[]): Record<MarketType, PerformanceStats> {
  return toBreakdown(groupBy(picks, (p) => p.market));
}

export function performanceByLeague(picks: readonly Pick[]): Record<string, PerformanceStats> {
  return toBreakdown(groupBy(picks, (p) => (p.leagueId ?? "unknown") as UUID));
}

/** Confidence range buckets: 0.0–0.2, 0.2–0.4, ..., 0.8–1.0, plus "unknown" for null confidence. */
export function performanceByConfidenceRange(picks: readonly Pick[]): Record<string, PerformanceStats> {
  const bucketFor = (confidence: number | null): string => {
    if (confidence === null) return "unknown";
    const bucketIndex = Math.min(Math.floor(confidence * 5), 4);
    const min = (bucketIndex * 0.2).toFixed(1);
    const max = ((bucketIndex + 1) * 0.2).toFixed(1);
    return `${min}-${max}`;
  };
  return toBreakdown(groupBy(picks, (p) => bucketFor(p.confidence)));
}
