import type {
  HistoricalResult,
  ISODateString,
  League,
  MarketOdds,
  Sport,
  SportEvent,
  Team,
  UUID,
} from "@tipstar/types";

/**
 * Base contract every sports data vendor adapter must satisfy. The
 * Intelligence Layer depends only on this interface (and its per-domain
 * extensions below), never on a specific vendor's SDK or response shape —
 * see Engineering Constitution O/Q ("External sports providers must be
 * abstracted behind provider interfaces").
 *
 * Implementations MUST return `null`/omit fields the underlying vendor does
 * not supply. Never fabricate data to fill a gap.
 */
export interface SportsProvider {
  readonly providerId: string;
  readonly sport: Sport;

  getLeagues(): Promise<readonly League[]>;
  getTeams(leagueId: UUID): Promise<readonly Team[]>;
  getEvents(params: { readonly leagueId?: UUID; readonly from?: ISODateString; readonly to?: ISODateString }): Promise<
    readonly SportEvent[]
  >;
  getEvent(eventId: UUID): Promise<SportEvent | null>;
  getOdds(eventId: UUID): Promise<readonly MarketOdds[]>;
  getHistoricalResult(eventId: UUID): Promise<HistoricalResult | null>;
}
