/**
 * DEVELOPMENT-ONLY MOCK ADAPTER. See mock-football-provider.ts header for
 * the rules governing mock adapters — never wire this into production.
 */
import type { HistoricalResult, League, MarketOdds, SportEvent, Team } from "@tipstar/types";
import { Sport, EventStatus } from "@tipstar/types";
import type { ResultDistribution, VirtualFootballProvider } from "../virtual-football.js";

const LEAGUE_ID = "00000000-0000-0000-0000-000000000003";
const EVENT_ID = "00000000-0000-0000-0000-000000000300";

export class MockVirtualFootballProvider implements VirtualFootballProvider {
  readonly providerId = "mock";
  readonly sport = Sport.VIRTUAL_FOOTBALL;

  async getLeagues(): Promise<League[]> {
    return [{ id: LEAGUE_ID, sport: Sport.VIRTUAL_FOOTBALL, name: "Mock Virtual League", country: null, provider: { providerId: this.providerId, providerEventId: LEAGUE_ID } }];
  }

  async getTeams(): Promise<Team[]> {
    return [];
  }

  async getEvents(): Promise<SportEvent[]> {
    const event = await this.getEvent(EVENT_ID);
    return event ? [event] : [];
  }

  async getEvent(eventId: string): Promise<SportEvent | null> {
    if (eventId !== EVENT_ID) return null;
    return {
      id: EVENT_ID,
      sport: Sport.VIRTUAL_FOOTBALL,
      leagueId: LEAGUE_ID,
      homeTeamId: null,
      awayTeamId: null,
      roundNumber: 42,
      scheduledAt: new Date().toISOString(),
      status: EventStatus.SCHEDULED,
      provider: { providerId: this.providerId, providerEventId: EVENT_ID },
      raw: null,
    };
  }

  async getOdds(): Promise<MarketOdds[]> {
    return [];
  }

  async getHistoricalResult(): Promise<HistoricalResult | null> {
    return null;
  }

  async getResultDistribution(leagueId: string): Promise<ResultDistribution | null> {
    return {
      leagueId,
      sampleSize: 500,
      outcomeFrequencies: { home: 0.42, draw: 0.24, away: 0.34 },
      computedAt: new Date().toISOString(),
    };
  }

  async getRecentSequence(): Promise<string[]> {
    return ["home", "away", "draw", "home", "home"];
  }
}
