import { NotImplementedError, type ISODateString } from "@sport-os/shared";

/**
 * The one typed boundary any automation agent may call to actually place
 * a real-money wager (Section 06 §10/16/37; extended Section 07 §12/13).
 * "Do not invent a SportyBet API... bookmaker execution endpoints...
 * hidden provider APIs. Use typed integration boundaries. If an
 * integration is unavailable: return an explicit NOT_AVAILABLE / MANUAL_
 * REQUIRED state. Never fake execution." No concrete, real implementation
 * of this interface exists anywhere in this codebase — `NotImplemented
 * ExecutionIntegration` below is the only one, and it is what every
 * automation agent is constructed with today. A real implementation is
 * out of Section 07's scope entirely (it would require a genuine,
 * authorized bookmaker integration, which does not exist).
 */

/**
 * Execution Result states (Section 07 §29). Only a confirmed external
 * result may ever be `EXECUTED` — nothing in this codebase manufactures
 * that state; it can only come back from a real `ExecutionIntegration`
 * implementation, which does not exist yet.
 */
export const ExecutionResultStatus = {
  REQUESTED: "REQUESTED",
  AUTHORIZED: "AUTHORIZED",
  SUBMITTED: "SUBMITTED",
  ACCEPTED: "ACCEPTED",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  MANUAL_REQUIRED: "MANUAL_REQUIRED",
} as const;
export type ExecutionResultStatus = (typeof ExecutionResultStatus)[keyof typeof ExecutionResultStatus];

/**
 * The canonical Execution Request contract (Section 07 §29/K). The
 * original three fields (`ticketOrSignalId`/`stake`/`idempotencyKey`) are
 * unchanged so every existing caller (`FootballAutomationAgent`,
 * `AviatorAutomationAgent`) keeps compiling untouched; the rest are
 * additive, optional context a real adapter would need to place the
 * exact selection this request means — never inferred/guessed by the
 * adapter itself.
 */
export interface ExecutionIntegrationRequest {
  readonly ticketOrSignalId: string;
  readonly stake: number;
  readonly idempotencyKey: string;
  readonly marketType?: string;
  readonly selection?: string;
  readonly odds?: number;
  readonly requestedAt?: ISODateString;
}

export interface ExecutionIntegrationResult {
  readonly externalReference: string;
  readonly stake: number;
  readonly executedAt: ISODateString;
  /** Section 07 addition — every result now carries an explicit status; a caller must check this rather than assume `execute()` resolving means `EXECUTED`. */
  readonly status: ExecutionResultStatus;
}

export type ExecutionValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly status: ExecutionResultStatus; readonly reason: string };

/**
 * `validate`/`status` (Section 07 §29/L): the execution adapter boundary
 * is `validate` (pre-flight — can this request even be attempted, without
 * placing anything) / `execute` (attempt it) / `status` (poll a
 * previously submitted request by its external reference). No agent may
 * skip `validate`+the `GlobalExecutionGate` and call `execute` directly —
 * enforced by `AgentOrchestrator.dispatch()` requiring a passing
 * `ExecutionAuthorizer.authorize()` before any EXECUTION-level agent runs
 * at all (see `agent-core/orchestrator.ts`).
 */
export interface ExecutionIntegration {
  isAvailable(): Promise<boolean>;
  validate(request: ExecutionIntegrationRequest): Promise<ExecutionValidationResult>;
  execute(request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult>;
  status(externalReference: string): Promise<ExecutionResultStatus>;
}

/** The only implementation of `ExecutionIntegration` in this codebase — always unavailable, and its `execute()`/`status()` throw rather than ever fabricating an execution result. `validate()` returns an explicit `NOT_AVAILABLE` result instead of throwing, since it is a pre-flight query a caller is expected to check before attempting `execute()`. */
export class NotImplementedExecutionIntegration implements ExecutionIntegration {
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async validate(_request: ExecutionIntegrationRequest): Promise<ExecutionValidationResult> {
    return { valid: false, status: ExecutionResultStatus.NOT_AVAILABLE, reason: "No permitted bookmaker integration is currently available." };
  }
  async execute(_request: ExecutionIntegrationRequest): Promise<ExecutionIntegrationResult> {
    throw new NotImplementedError("ExecutionIntegration.execute");
  }
  async status(_externalReference: string): Promise<ExecutionResultStatus> {
    throw new NotImplementedError("ExecutionIntegration.status");
  }
}
