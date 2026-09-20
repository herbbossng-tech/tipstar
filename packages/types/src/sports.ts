import type { ISODateString, Maybe, UUID } from "./common.js";

/**
 * Top-level sport/domain classification. Virtual Football is intentionally
 * distinct from Football at the data-model level (see architecture docs,
 * "Virtual Football is its own domain").
 */
export const Sport = {
  FOOTBALL: "football",
  BASKETBALL: "basketball",
  VIRTUAL_FOOTBALL: "virtual_football",
  AVIATOR: "aviator",
} as const;
export type Sport = (typeof Sport)[keyof typeof Sport];

export const EventStatus = {
  SCHEDULED: "scheduled",
  LIVE: "live",
  FINISHED: "finished",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
  ABANDONED: "abandoned",
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

/** Identifies which external vendor supplied a piece of data, without leaking vendor logic into consumers. */
export interface ProviderRef {
  readonly providerId: string;
  readonly providerEventId: string;
}

export interface League {
  readonly id: UUID;
  readonly sport: Sport;
  readonly name: string;
  readonly country: Maybe<string>;
  readonly provider: ProviderRef;
}

export interface Team {
  readonly id: UUID;
  readonly name: string;
  readonly shortName: Maybe<string>;
  readonly logoUrl: Maybe<string>;
  readonly provider: ProviderRef;
}

export interface Player {
  readonly id: UUID;
  readonly name: string;
  readonly teamId: Maybe<UUID>;
  readonly position: Maybe<string>;
  readonly provider: ProviderRef;
}

/**
 * A normalized sporting/event fixture, independent of the vendor that
 * supplied it. Real fixtures (football/basketball) use participants;
 * round-based domains (virtual football, aviator) use roundNumber instead.
 * Fields the active provider doesn't supply MUST be null, never invented
 * (Engineering Constitution section N / "Sports Data Abstraction").
 */
export interface SportEvent {
  readonly id: UUID;
  readonly sport: Sport;
  readonly leagueId: Maybe<UUID>;
  readonly homeTeamId: Maybe<UUID>;
  readonly awayTeamId: Maybe<UUID>;
  readonly roundNumber: Maybe<number>;
  readonly scheduledAt: ISODateString;
  readonly status: EventStatus;
  readonly provider: ProviderRef;
  readonly raw: Maybe<Record<string, unknown>>;
}

export interface Lineup {
  readonly eventId: UUID;
  readonly teamId: UUID;
  readonly players: readonly Player[];
  readonly formation: Maybe<string>;
}

export interface InjuryReport {
  readonly playerId: UUID;
  readonly status: "out" | "doubtful" | "questionable" | "available";
  readonly description: Maybe<string>;
  readonly reportedAt: ISODateString;
}

export type MarketType =
  // Football
  | "1x2"
  | "double_chance"
  | "over_under"
  | "btts"
  | "asian_handicap"
  | "corners"
  | "cards"
  // Basketball
  | "moneyline"
  | "point_spread"
  | "team_totals"
  | "quarter_result"
  | "half_result"
  // Generic / round-based
  | "player_prop"
  | "round_outcome"
  | "multiplier_threshold";

export interface MarketOdds {
  readonly eventId: UUID;
  readonly market: MarketType;
  readonly selection: string;
  readonly odds: number;
  readonly bookmakerId: Maybe<string>;
  readonly capturedAt: ISODateString;
  readonly provider: ProviderRef;
}

export interface HistoricalResult {
  readonly eventId: UUID;
  readonly finalScoreHome: Maybe<number>;
  readonly finalScoreAway: Maybe<number>;
  readonly statistics: Maybe<Record<string, number | string>>;
  readonly settledAt: ISODateString;
}

/** Aviator/round-based domains: a single completed round outcome. */
export interface RoundOutcome {
  readonly roundId: UUID;
  readonly sport: Sport;
  readonly multiplier: Maybe<number>;
  readonly occurredAt: ISODateString;
  readonly provider: ProviderRef;
}
