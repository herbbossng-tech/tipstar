/**
 * DEVELOPMENT-ONLY MOCK ADAPTER.
 *
 * Returns deterministic fixture data so the Intelligence/Decision/Pick
 * layers can be developed and tested before a real vendor integration
 * exists. This must NEVER be wired into a production environment, and
 * results derived from it must always be flagged (see IntelligenceResult.isMock).
 */
import type { HistoricalResult, InjuryReport, League, Lineup, MarketOdds, SportEvent, Team } from "@tipstar/types";
import { Sport, EventStatus } from "@tipstar/types";
import type { FootballProvider, HeadToHeadRecord } from "../football.js";

const LEAGUE_ID = "00000000-0000-0000-0000-000000000001";
const HOME_TEAM_ID = "00000000-0000-0000-0000-000000000010";
const AWAY_TEAM_ID = "00000000-0000-0000-0000-000000000011";
const EVENT_ID = "00000000-0000-0000-0000-000000000100";

export class MockFootballProvider implements FootballProvider {
  readonly providerId = "mock";
  readonly sport = Sport.FOOTBALL;

  async getLeagues(): Promise<League[]> {
    return [
      {
        id: LEAGUE_ID,
        sport: Sport.FOOTBALL,
        name: "Mock Premier League",
        country: "Mockland",
        provider: { providerId: this.providerId, providerEventId: LEAGUE_ID },
      },
    ];
  }

  async getTeams(): Promise<Team[]> {
    return [
      { id: HOME_TEAM_ID, name: "Mock United", shortName: "MUN", logoUrl: null, provider: { providerId: this.providerId, providerEventId: HOME_TEAM_ID } },
      { id: AWAY_TEAM_ID, name: "Mock City", shortName: "MCI", logoUrl: null, provider: { providerId: this.providerId, providerEventId: AWAY_TEAM_ID } },
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
      sport: Sport.FOOTBALL,
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
    return [
      { eventId, market: "1x2", selection: "home", odds: 2.1, bookmakerId: null, capturedAt: new Date().toISOString(), provider: { providerId: this.providerId, providerEventId: eventId } },
      { eventId, market: "1x2", selection: "draw", odds: 3.4, bookmakerId: null, capturedAt: new Date().toISOString(), provider: { providerId: this.providerId, providerEventId: eventId } },
      { eventId, market: "1x2", selection: "away", odds: 3.2, bookmakerId: null, capturedAt: new Date().toISOString(), provider: { providerId: this.providerId, providerEventId: eventId } },
    ];
  }

  async getHistoricalResult(): Promise<HistoricalResult | null> {
    // Not yet played in this fixture — unavailable, not fabricated.
    return null;
  }

  async getLineups(): Promise<Lineup[] | null> {
    // This mock vendor does not supply lineups.
    return null;
  }

  async getInjuries(): Promise<InjuryReport[]> {
    return [];
  }

  async getHeadToHead(homeTeamId: string, awayTeamId: string): Promise<HeadToHeadRecord | null> {
    return { homeTeamId, awayTeamId, meetings: [] };
  }
}
