import { describe, expect, it } from "vitest";
import { ValidationError } from "@sport-os/shared";
import { InMemoryAgentRegistry } from "./agent-service.js";
import { BaseAgent } from "./base-agent.js";
import type { AgentRequest, AgentResponse } from "./types.js";

class EchoAgent extends BaseAgent<string, string> {
  async execute(request: AgentRequest<string>): Promise<AgentResponse<string>> {
    return { requestId: request.requestId, output: request.input, completedAt: new Date().toISOString() };
  }
}

function buildAgent(id: string, agentType: "football_intelligence" | "aviator_intelligence" = "football_intelligence") {
  return new EchoAgent({ agentId: id, agentType, name: `Agent ${id}`, version: "0.1.0" });
}

describe("InMemoryAgentRegistry", () => {
  it("registers and retrieves an agent by id", () => {
    const registry = new InMemoryAgentRegistry();
    const agent = buildAgent("a1");
    registry.register(agent);
    expect(registry.get("a1")).toBe(agent);
  });

  it("rejects registering two agents under the same id", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(buildAgent("a1"));
    expect(() => registry.register(buildAgent("a1"))).toThrow(ValidationError);
  });

  it("lists agents filtered by type", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(buildAgent("a1", "football_intelligence"));
    registry.register(buildAgent("a2", "aviator_intelligence"));
    registry.register(buildAgent("a3", "football_intelligence"));
    expect(registry.listByType("football_intelligence").map((a) => a.agentId).sort()).toEqual(["a1", "a3"]);
  });

  it("routes execute() to the registered agent's own implementation", async () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(buildAgent("a1"));
    const response = await registry.execute<string, string>("a1", { requestId: "req-1", input: "hello", audit: { requestId: "req-1", actor: "tester" } });
    expect(response.output).toBe("hello");
  });

  it("rejects executing a request against an unregistered agent id", async () => {
    const registry = new InMemoryAgentRegistry();
    await expect(registry.execute("missing", { requestId: "req-1", input: undefined, audit: { requestId: "req-1", actor: "tester" } })).rejects.toThrow(
      ValidationError,
    );
  });
});
