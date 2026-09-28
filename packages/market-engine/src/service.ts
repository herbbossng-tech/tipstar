import { NotImplementedError } from "@sport-os/shared";
import type { MarketType, OddsSnapshot } from "./types.js";

/**
 * MarketService — odds/market data boundary (Section 01 — Backend/
 * Service Boundaries). Real provider integration and value calculation
 * are later-section concerns (see docs/data leakage principle — market
 * data must only ever reflect what was genuinely available at the time).
 */
export interface MarketService {
  getLatestOdds(eventId: string, marketType: MarketType): Promise<OddsSnapshot | undefined>;
}

export class NotImplementedMarketService implements MarketService {
  async getLatestOdds(_eventId: string, _marketType: MarketType): Promise<OddsSnapshot | undefined> {
    throw new NotImplementedError("MarketService.getLatestOdds");
  }
}
