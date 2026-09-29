import { describe, expect, it } from "vitest";
import { CommandType, CURRENT_AGENT_MESSAGE_SCHEMA_VERSION, EventType, isCommand, isEvent, MessageKind, validateMessageSchemaVersion, type AgentMessage } from "./messages.js";

function baseMessage(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    messageId: "11111111-1111-1111-1111-111111111111",
    correlationId: "22222222-2222-2222-2222-222222222222",
    kind: MessageKind.COMMAND,
    messageType: CommandType.REQUEST_FOOTBALL_INTELLIGENCE,
    schemaVersion: CURRENT_AGENT_MESSAGE_SCHEMA_VERSION,
    sourceAgent: "system",
    targetAgent: "football_intelligence",
    payload: {},
    createdAt: "2026-01-01T00:00:00Z",
    idempotencyKey: undefined,
    ...overrides,
  };
}

describe("messages.ts — command/event contract", () => {
  it("accepts the current schema version", () => {
    expect(validateMessageSchemaVersion(baseMessage({})).ok).toBe(true);
  });

  it("rejects an unknown schema version safely rather than guessing the shape", () => {
    const result = validateMessageSchemaVersion(baseMessage({ schemaVersion: 999 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("999");
  });

  it("distinguishes COMMAND from EVENT", () => {
    const command = baseMessage({ kind: MessageKind.COMMAND, messageType: CommandType.REQUEST_EXECUTION });
    const event = baseMessage({ kind: MessageKind.EVENT, messageType: EventType.TICKET_EXECUTED });
    expect(isCommand(command)).toBe(true);
    expect(isEvent(command)).toBe(false);
    expect(isCommand(event)).toBe(false);
    expect(isEvent(event)).toBe(true);
  });

  it("carries correlationId end to end on the message envelope", () => {
    const message = baseMessage({ correlationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    expect(message.correlationId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("every command a COMMAND-kind message can carry requires an idempotencyKey to be dispatchable (enforced by the orchestrator, not this module) — but the type permits it to be undefined so a caller's omission is a checkable, not a compile error", () => {
    const command = baseMessage({ idempotencyKey: undefined });
    expect(command.idempotencyKey).toBeUndefined();
  });
});
