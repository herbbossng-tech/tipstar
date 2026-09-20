import { describe, expect, it } from "vitest";
import { MockFootballProvider } from "@tipstar/sports";
import { IntelligenceResultStatus } from "@tipstar/types";
import { FootballAgent } from "./football-agent.js";

const provider = new MockFootballProvider();
const EVENT_ID = "00000000-0000-0000-0000-000000000100";

describe("FootballAgent", () => {
  it("production mode honestly reports insufficient_data when no model exists", async () => {
    const agent = new FootballAgent(provider, "production");
    const result = await agent.evaluate({ eventId: EVENT_ID, market: "1x2", selection: "home" });

    expect(result.status).toBe(IntelligenceResultStatus.INSUFFICIENT_DATA);
    expect(result.isMock).toBe(false);
    expect(result.probability).toBeNull();
  });

  it("mock mode returns a result clearly flagged as mock, never as a real prediction", async () => {
    const agent = new FootballAgent(provider, "mock");
    const result = await agent.evaluate({ eventId: EVENT_ID, market: "1x2", selection: "home" });

    expect(result.isMock).toBe(true);
    expect(result.status).toBe(IntelligenceResultStatus.GENERATED);
    expect(result.probability).not.toBeNull();
  });
});
