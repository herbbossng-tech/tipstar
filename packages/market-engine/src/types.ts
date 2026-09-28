import type { ISODateString } from "@sport-os/shared";

export const MarketType = {
  MATCH_RESULT_1X2: "match_result_1x2",
  OVER_UNDER: "over_under",
  BOTH_TEAMS_TO_SCORE: "both_teams_to_score",
  DOUBLE_CHANCE: "double_chance",
} as const;
export type MarketType = (typeof MarketType)[keyof typeof MarketType];

/** A single provider-sourced odds observation. Never fabricated — a provider gap is `null`, not a guess. */
export interface OddsSnapshot {
  readonly eventId: string;
  readonly marketType: MarketType;
  readonly selection: string;
  readonly odds: number | null;
  readonly providerId: string;
  readonly observedAt: ISODateString;
}
