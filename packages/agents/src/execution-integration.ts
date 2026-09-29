import { NotImplementedError, type ISODateString } from "@sport-os/shared";

/**
 * The one typed boundary any automation agent may call to actually place
 * a real-money wager (Section 06 §10/16/37). "Do not invent a
 * SportyBet API... bookmaker execution endpoints... hidden provider
 * APIs. Use typed integration boundaries. If an integration is
 * unavailable: return an explicit NOT_AVAILABLE / MANUAL_REQUIRED
 * state. Never fake execution." No concrete, real implementation of
 * this interface exists anywhere in this codebase — `NotImplemented
 * ExecutionIntegration` below is the only one, and it is what every
 * automation agent is constructed with today. A real implementation is
 * out of Section 06's scope entirely (it would require a genuine,
 * authorized bookmaker integration, which does not exist).
 */
export interface ExecutionIntegrationRequest {
  readonly ticketOrSignalId: string;
  readonly stake: number;
  readonly idempotencyKey: string;
}

export interface ExecutionIntegrationResult {
  readonly externalReference: string;
  readonly stake: number;
  readonly executedAt: ISODateString;
}

export interface ExecutionIntegration {
  isAvailable(): Promise<boolean>;
  execute(request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult>;
}

/** The only implementation of `ExecutionIntegration` in this codebase — always unavailable, and its `execute()` throws rather than ever fabricating an execution result. */
export class NotImplementedExecutionIntegration implements ExecutionIntegration {
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async execute(_request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult> {
    throw new NotImplementedError("ExecutionIntegration.execute");
  }
}
