import { AviatorSignalState, type AviatorSignal, type AviatorSignalEngine } from "@sport-os/aviator-engine";
import { describe, expect, it } from "vitest";
import { AviatorIntelligenceAgent } from "./intelligence-agent.js";

class StubSignalEngine implements AviatorSignalEngine {
  constructor(private readonly signal: AviatorSignal | undefined) {}
  async generateSignal(): Promise<AviatorSignal | undefined> {
    return this.signal;
  }
}

describe("AviatorIntelligenceAgent", () => {
  it("passes through a real signal from the engine, using only allowed states", async () => {
    const signal: AviatorSignal = { signalId: "sig-1", state: AviatorSignalState.BUY, targetMultiplier: 1.5, confidence: 0.7, generatedAt: "2026-01-01T00:00:00Z" };
    const agent = new AviatorIntelligenceAgent({ signalEngine: new StubSignalEngine(signal) });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { methodologyVersion: "v1" }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.signal?.state).toBe(AviatorSignalState.BUY);
  });

  it("passes through undefined when the engine has no signal at all — never fabricates one", async () => {
    const agent = new AviatorIntelligenceAgent({ signalEngine: new StubSignalEngine(undefined) });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { methodologyVersion: "v1" }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(response.output.signal).toBeUndefined();
  });

  it("never executes anything — this agent has no dependency capable of causing a real-world effect", async () => {
    const signal: AviatorSignal = { signalId: "sig-1", state: AviatorSignalState.BUY, targetMultiplier: 1.5, confidence: 0.7, generatedAt: "2026-01-01T00:00:00Z" };
    const agent = new AviatorIntelligenceAgent({ signalEngine: new StubSignalEngine(signal) });
    agent.markReady();
    const response = await agent.execute({ requestId: "req-1", input: { methodologyVersion: "v1" }, audit: { requestId: "req-1", actor: "user-1" } });
    expect(Object.keys(response.output)).not.toContain("executionResult");
    expect(Object.keys(response.output)).not.toContain("stake");
  });
});
