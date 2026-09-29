import type { ISODateString, UUID } from "@sport-os/shared";

/**
 * Every agent named in the Master Blueprint V1.0 product definition.
 * Adding a new agent means adding one value here — nothing else in this
 * package needs to change (Section 01 — Agent Core Foundation).
 *
 * `GLOBAL_DAILY_RISK_CONTROLLER` is deliberately never given a concrete
 * `Agent` implementation (Section 06 — Agent Architecture, §4:
 * "Global Daily Risk Controller is NOT an unrestricted autonomous agent.
 * It remains a centralized risk-control service governed by the existing
 * GlobalExecutionGate architecture. Do not create a second independent
 * global risk authority."). The value stays defined here only so it
 * remains a documented, reservable `AgentType` — `@sport-os/risk-engine`'s
 * `GlobalDailyRiskController` is the one real authority; `@sport-os/agents`'
 * Aviator Risk Agent consults it directly rather than wrapping it as a
 * peer agent.
 */
export const AgentType = {
  FOOTBALL_INTELLIGENCE: "football_intelligence",
  FOOTBALL_DECISION: "football_decision",
  FOOTBALL_AUTOMATION: "football_automation",
  TELEGRAM_CHANNEL_MANAGEMENT: "telegram_channel_management",
  SETTLEMENT: "settlement",
  WEEKLY_REPORT: "weekly_report",
  AVIATOR_INTELLIGENCE: "aviator_intelligence",
  AVIATOR_RISK: "aviator_risk",
  AVIATOR_AUTOMATION: "aviator_automation",
  GLOBAL_DAILY_RISK_CONTROLLER: "global_daily_risk_controller",
  PERFORMANCE: "performance",
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

/**
 * Agent lifecycle states (Section 01 — Agent Core Foundation). This is the
 * complete, locked set — do not add a state here without updating this
 * doc comment and docs/architecture/MODULE_BOUNDARIES.md.
 *
 * Valid transitions (enforced by BaseAgent, see base-agent.ts):
 *   DISABLED      -> INITIALIZING
 *   INITIALIZING  -> READY | ERROR
 *   READY         -> RUNNING | DISABLED
 *   RUNNING       -> READY | PAUSED | ERROR
 *   PAUSED        -> RUNNING | DISABLED
 *   ERROR         -> INITIALIZING | DISABLED
 */
export const AgentStatus = {
  DISABLED: "disabled",
  INITIALIZING: "initializing",
  READY: "ready",
  RUNNING: "running",
  PAUSED: "paused",
  ERROR: "error",
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export interface AgentHealth {
  readonly status: AgentStatus;
  readonly lastCheckedAt: ISODateString;
  readonly detail?: string;
}

export interface AgentAuditContext {
  readonly requestId: string;
  readonly actor: string;
  readonly correlationId?: string;
}

export interface AgentRequest<TInput = unknown> {
  readonly requestId: string;
  readonly input: TInput;
  readonly audit: AgentAuditContext;
}

export interface AgentResponse<TOutput = unknown> {
  readonly requestId: string;
  readonly output: TOutput;
  readonly completedAt: ISODateString;
}

/**
 * The reusable contract every future agent implements. Authorization,
 * license checks, risk checks, and execution gating sit ABOVE this
 * interface (see @sport-os/platform's GlobalExecutionGate) — an Agent
 * implementation only knows how to do its own job once permitted.
 */
export interface Agent<TInput = unknown, TOutput = unknown> {
  readonly agentId: UUID;
  readonly agentType: AgentType;
  readonly name: string;
  readonly version: string;
  readonly status: AgentStatus;
  readonly capabilities: readonly string[];
  readonly configuration: Readonly<Record<string, unknown>>;

  execute(request: AgentRequest<TInput>): Promise<AgentResponse<TOutput>>;
  getHealth(): AgentHealth;
}
