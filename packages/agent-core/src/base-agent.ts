import { ValidationError } from "@sport-os/shared";
import { AgentStatus, type Agent, type AgentAuditContext, type AgentHealth, type AgentRequest, type AgentResponse, type AgentType } from "./types.js";

/** The only lifecycle transitions BaseAgent permits — see types.ts's doc comment for the diagram. */
const ALLOWED_TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  [AgentStatus.DISABLED]: [AgentStatus.INITIALIZING],
  [AgentStatus.INITIALIZING]: [AgentStatus.READY, AgentStatus.ERROR],
  [AgentStatus.READY]: [AgentStatus.RUNNING, AgentStatus.DISABLED],
  [AgentStatus.RUNNING]: [AgentStatus.READY, AgentStatus.PAUSED, AgentStatus.ERROR],
  [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.DISABLED],
  [AgentStatus.ERROR]: [AgentStatus.INITIALIZING, AgentStatus.DISABLED],
};

export interface BaseAgentOptions {
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly name: string;
  readonly version: string;
  readonly capabilities?: readonly string[];
  readonly configuration?: Readonly<Record<string, unknown>>;
}

/**
 * Reusable lifecycle skeleton every concrete agent extends. Enforces that
 * status only ever moves along a documented, valid edge — this is
 * architecture (state-machine correctness), not business logic, so it is
 * safe to implement concretely in Section 01.
 */
export abstract class BaseAgent<TInput = unknown, TOutput = unknown> implements Agent<TInput, TOutput> {
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;

  private currentStatus: AgentStatus = AgentStatus.DISABLED;
  private lastCheckedAt: string = new Date().toISOString();

  constructor(options: BaseAgentOptions) {
    this.agentId = options.agentId;
    this.agentType = options.agentType;
    this.name = options.name;
    this.version = options.version;
    this.capabilities = options.capabilities ?? [];
    this.configuration = Object.freeze({ ...(options.configuration ?? {}) });
  }

  get status(): AgentStatus {
    return this.currentStatus;
  }

  /**
   * Moves the agent to `next`, throwing ValidationError if `next` is not a
   * documented valid transition from the current status.
   */
  protected transitionTo(next: AgentStatus): void {
    const allowed = ALLOWED_TRANSITIONS[this.currentStatus];
    if (!allowed.includes(next)) {
      throw new ValidationError({
        message: `Invalid agent lifecycle transition for "${this.name}": ${this.currentStatus} -> ${next}.`,
        context: { agentId: this.agentId, from: this.currentStatus, to: next, allowed },
      });
    }
    this.currentStatus = next;
    this.lastCheckedAt = new Date().toISOString();
  }

  getHealth(): AgentHealth {
    return { status: this.currentStatus, lastCheckedAt: this.lastCheckedAt };
  }

  protected buildAuditContext(requestId: string, actor: string, correlationId?: string): AgentAuditContext {
    return { requestId, actor, ...(correlationId !== undefined ? { correlationId } : {}) };
  }

  abstract execute(request: AgentRequest<TInput>): Promise<AgentResponse<TOutput>>;
}
