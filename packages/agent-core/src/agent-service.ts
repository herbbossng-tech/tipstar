import { ValidationError } from "@sport-os/shared";
import type { Agent, AgentRequest, AgentResponse, AgentType } from "./types.js";

/**
 * AgentService — one of the 14 backend/service boundaries named in
 * Section 01. Registers and looks up agent instances; routing a request
 * through the GlobalExecutionGate before calling `execute` is the
 * caller's responsibility (see @sport-os/platform).
 */
export interface AgentService {
  register(agent: Agent): void;
  get(agentId: string): Agent | undefined;
  listByType(agentType: AgentType): readonly Agent[];
  list(): readonly Agent[];
  execute<TInput, TOutput>(agentId: string, request: AgentRequest<TInput>): Promise<AgentResponse<TOutput>>;
}

/**
 * In-memory agent registry. This is pure bookkeeping (no prediction/
 * business logic), so a real implementation belongs in Section 01 — a
 * persistent, Supabase-backed registry is a later-section concern.
 */
export class InMemoryAgentRegistry implements AgentService {
  private readonly agentsById = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agentsById.has(agent.agentId)) {
      throw new ValidationError({ message: `An agent with id "${agent.agentId}" is already registered.`, context: { agentId: agent.agentId } });
    }
    this.agentsById.set(agent.agentId, agent);
  }

  get(agentId: string): Agent | undefined {
    return this.agentsById.get(agentId);
  }

  listByType(agentType: AgentType): readonly Agent[] {
    return this.list().filter((agent) => agent.agentType === agentType);
  }

  list(): readonly Agent[] {
    return Array.from(this.agentsById.values());
  }

  async execute<TInput, TOutput>(agentId: string, request: AgentRequest<TInput>): Promise<AgentResponse<TOutput>> {
    const agent = this.agentsById.get(agentId);
    if (!agent) {
      throw new ValidationError({ message: `No agent registered with id "${agentId}".`, context: { agentId } });
    }
    // Pure routing — whether the underlying agent is actually implemented
    // yet (and throws NotImplementedError) is that agent's concern, not
    // the registry's. Type erasure through the map means a cast is
    // required here; callers are responsible for matching TInput/TOutput
    // to the agent they registered under `agentId`.
    return (agent as Agent<TInput, TOutput>).execute(request);
  }
}
