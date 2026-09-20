import type { InjuryReport, UUID } from "@tipstar/types";
import type { SportsProvider } from "./provider.js";

export interface PlayerAvailability {
  readonly playerId: UUID;
  readonly isAvailable: boolean;
  readonly minutesRestrictionNote: string | null;
}

/** Basketball-specific data a vendor may (or may not) supply, per Section 10. */
export interface BasketballProvider extends SportsProvider {
  getInjuries(teamId: UUID): Promise<readonly InjuryReport[]>;
  getPlayerAvailability(eventId: UUID, teamId: UUID): Promise<readonly PlayerAvailability[]>;
  /** True on the second game of a back-to-back for this team, when the provider tracks scheduling. */
  isBackToBack(teamId: UUID, eventId: UUID): Promise<boolean | null>;
}
