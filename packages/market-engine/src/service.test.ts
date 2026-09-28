import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@sport-os/shared";
import { NotImplementedMarketService } from "./service.js";
import { MarketType } from "./types.js";

describe("NotImplementedMarketService", () => {
  it("throws NotImplementedError rather than returning fabricated odds", async () => {
    const service = new NotImplementedMarketService();
    await expect(service.getLatestOdds("event-1", MarketType.MATCH_RESULT_1X2)).rejects.toThrow(NotImplementedError);
  });
});
