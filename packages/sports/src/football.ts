import type { InjuryReport, Lineup, UUID } from "@tipstar/types";
import type { SportsProvider } from "./provider.js";

export interface HeadToHeadRecord {
  readonly homeTeamId: UUID;
  readonly awayTeamId: UUID;
  readonly meetings: readonly { readonly eventId: UUID; readonly playedAt: string }[];
}

/** Football-specific data a vendor may (or may not) supply, per Section 10. */
export interface FootballProvider extends SportsProvider {
  getLineups(eventId: UUID): Promise<Lineup[] | null>;
  getInjuries(teamId: UUID): Promise<readonly InjuryReport[]>;
  getHeadToHead(homeTeamId: UUID, awayTeamId: UUID): Promise<HeadToHeadRecord | null>;
}
