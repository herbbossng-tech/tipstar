/**
 * DEVELOPMENT-ONLY MOCK ADAPTER. See mock-football-provider.ts header for
 * the rules governing mock adapters — never wire this into production.
 */
import type { HistoricalResult, InjuryReport, League, MarketOdds, SportEvent, Team } from "@tipstar/types";
import { Sport, EventStatus } from "@tipstar/types";
import type { BasketballProvider, PlayerAvailability } from "../basketball.js";

const LEAGUE_ID = "00000000-0000-0000-0000-000000000002";
const HOME_TEAM_ID = "00000000-0000-0000-0000-000000000020";
const AWAY_TEAM_ID = "00000000-0000-0000-0000-000000000021";
const EVENT_ID = "00000000-0000-0000-0000-000000000200";

export class MockBasketballProvider implements BasketballProvider {
  readonly providerId = "mock";
  readonly sport = Sport.BASKETBALL;

  async getLeagues(): Promise<League[]> {
    return [{ id: LEAGUE_ID, sport: Sport.BASKETBALL, name: "Mock Hoops League", country: "Mockland", provider: { providerId: this.providerId, providerEventId: LEAGUE_ID } }];
  }

  async getTeams(): Promise<Team[]> {
    return [
      { id: HOME_TEAM_ID, name: "Mock Ballers", shortName: "MBL", logoUrl: null, provider: { providerId: this.providerId, providerEventId: HOME_TEAM_ID } },
      { id: AWAY_TEAM_ID, name: "Mock Shooters", shortName: "MSH", logoUrl: null, provider: { providerId: this.providerId, providerEventId: AWAY_TEAM_ID } },
    ];
  }

  async getEvents(): Promise<SportEvent[]> {
    const event = await this.getEvent(EVENT_ID);
    return event ? [event] : [];
  }

  async getEvent(eventId: string): Promise<SportEvent | null> {
    if (eventId !== EVENT_ID) return null;
    return {
      id: EVENT_ID,
      sport: Sport.BASKETBALL,
      leagueId: LEAGUE_ID,
      homeTeamId: HOME_TEAM_ID,
      awayTeamId: AWAY_TEAM_ID,
      roundNumber: null,
      scheduledAt: new Date().toISOString(),
      status: EventStatus.SCHEDULED,
      provider: { providerId: this.providerId, providerEventId: EVENT_ID },
      raw: null,
    };
  }

  async getOdds(eventId: string): Promise<MarketOdds[]> {
    if (eventId !== EVENT_ID) return [];
    return [{ eventId, market: "moneyline", selection: "home", odds: 1.85, bookmakerId: null, capturedAt: new Date().toISOString(), provider: { providerId: this.providerId, providerEventId: eventId } }];
  }

  async getHistoricalResult(): Promise<HistoricalResult | null> {
    return null;
  }

  async getInjuries(): Promise<InjuryReport[]> {
    return [];
  }

  async getPlayerAvailability(): Promise<PlayerAvailability[]> {
    return [];
  }

  async isBackToBack(): Promise<boolean | null> {
    // This mock vendor does not track scheduling density.
    return null;
  }
}
