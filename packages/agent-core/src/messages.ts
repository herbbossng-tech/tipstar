import type { ISODateString, UUID } from "@sport-os/shared";
import type { AgentType } from "./types.js";

/**
 * Agent-to-agent communication contract (Section 06 §18/19). No agent
 * calls another agent's methods directly anywhere in this codebase —
 * every cross-agent interaction is a typed, versioned `AgentMessage`
 * routed through `AgentOrchestrator` (orchestrator.ts).
 *
 * COMMAND: "please perform this action" — may trigger a side effect once
 * authorized. EVENT: "this already happened" — a fact, never itself a
 * trigger for execution (an event handler that reacts to an event by
 * causing a new side effect must issue its own COMMAND and go through
 * the gate again, never treat receipt of the event as authorization).
 */
export const MessageKind = { COMMAND: "command", EVENT: "event" } as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

/** The closed set of commands named in Section 06 §19. Extend only by adding here, never by inventing an ad hoc string at a call site. */
export const CommandType = {
  REQUEST_FOOTBALL_INTELLIGENCE: "REQUEST_FOOTBALL_INTELLIGENCE",
  REQUEST_VALUE_ANALYSIS: "REQUEST_VALUE_ANALYSIS",
  REQUEST_TICKET_VALIDATION: "REQUEST_TICKET_VALIDATION",
  REQUEST_EXECUTION: "REQUEST_EXECUTION",
  REQUEST_PUBLICATION: "REQUEST_PUBLICATION",
  REQUEST_SETTLEMENT: "REQUEST_SETTLEMENT",
  REQUEST_WEEKLY_REPORT: "REQUEST_WEEKLY_REPORT",
  REQUEST_AVIATOR_SIGNAL: "REQUEST_AVIATOR_SIGNAL",
  REQUEST_AVIATOR_RISK_CHECK: "REQUEST_AVIATOR_RISK_CHECK",
  REQUEST_PERFORMANCE_REPORT: "REQUEST_PERFORMANCE_REPORT",
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

/** The closed set of events named in Section 06 §19, plus the ones the additional agents (settlement/weekly-report/aviator/performance) need. */
export const EventType = {
  INTELLIGENCE_GENERATED: "INTELLIGENCE_GENERATED",
  TICKET_PROPOSED: "TICKET_PROPOSED",
  TICKET_EXECUTED: "TICKET_EXECUTED",
  TICKET_SETTLED: "TICKET_SETTLED",
  PUBLICATION_COMPLETED: "PUBLICATION_COMPLETED",
  RISK_LIMIT_REACHED: "RISK_LIMIT_REACHED",
  AVIATOR_SIGNAL_GENERATED: "AVIATOR_SIGNAL_GENERATED",
  AVIATOR_EXECUTION_COMPLETED: "AVIATOR_EXECUTION_COMPLETED",
  WEEKLY_REPORT_GENERATED: "WEEKLY_REPORT_GENERATED",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export type AgentMessageType = CommandType | EventType;

/** The only schema version this build understands. Bump when `AgentMessage`'s shape changes in a way older consumers can't safely ignore. */
export const CURRENT_AGENT_MESSAGE_SCHEMA_VERSION = 1;

export interface AgentMessage<TPayload = unknown> {
  readonly messageId: UUID;
  readonly correlationId: UUID;
  readonly kind: MessageKind;
  readonly messageType: AgentMessageType;
  readonly schemaVersion: number;
  readonly sourceAgent: AgentType | "system";
  readonly targetAgent: AgentType;
  readonly payload: TPayload;
  readonly createdAt: ISODateString;
  /** Required on every COMMAND (idempotent processing is mandatory per §20); optional/absent on an EVENT, which is a fact, not a retryable action. */
  readonly idempotencyKey: string | undefined;
}

export type UnknownSchemaVersionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * "Unknown schema versions must fail safely" (§18). A message whose
 * `schemaVersion` this build doesn't recognize is rejected outright — it
 * is never partially parsed, never defaulted to the current shape.
 */
export function validateMessageSchemaVersion(message: Pick<AgentMessage, "schemaVersion">): UnknownSchemaVersionResult {
  if (message.schemaVersion !== CURRENT_AGENT_MESSAGE_SCHEMA_VERSION) {
    return { ok: false, reason: `Unsupported agent message schema version ${message.schemaVersion}; this build only understands version ${CURRENT_AGENT_MESSAGE_SCHEMA_VERSION}.` };
  }
  return { ok: true };
}

/** A COMMAND must never be handled as if it were an already-true EVENT, and vice versa — the one mechanical check that enforces §19's "do not treat events as commands." */
export function isCommand(message: Pick<AgentMessage, "kind">): boolean {
  return message.kind === MessageKind.COMMAND;
}

export function isEvent(message: Pick<AgentMessage, "kind">): boolean {
  return message.kind === MessageKind.EVENT;
}
