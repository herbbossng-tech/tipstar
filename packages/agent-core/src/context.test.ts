import { describe, expect, it } from "vitest";
import { buildAgentExecutionContext } from "./context.js";

describe("context.ts — AgentExecutionContext", () => {
  it("builds an immutable context that cannot be mutated after construction", () => {
    const context = buildAgentExecutionContext({
      invocationId: "11111111-1111-1111-1111-111111111111",
      correlationId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      actorRole: "user",
      environment: "development",
      requestedOperation: "request_football_intelligence",
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.trace)).toBe(true);
    expect(() => {
      // @ts-expect-error — intentionally attempting a runtime mutation of a readonly field.
      context.actorUserId = "should-not-be-allowed";
    }).toThrow();
  });

  it("never carries a raw Telegram initData string or session token — only the numeric telegramUserId is representable at all", () => {
    const context = buildAgentExecutionContext({
      invocationId: "11111111-1111-1111-1111-111111111111",
      correlationId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      actorRole: "user",
      telegramUserId: 123456789,
      environment: "development",
      requestedOperation: "request_football_intelligence",
    });
    expect(context.telegramUserId).toBe(123456789);
    expect(Object.keys(context)).not.toContain("initData");
    expect(Object.keys(context)).not.toContain("sessionToken");
  });

  it("defaults telegramUserId/subjectReference/snapshotTime/idempotencyKey to undefined rather than a fabricated placeholder", () => {
    const context = buildAgentExecutionContext({
      invocationId: "11111111-1111-1111-1111-111111111111",
      correlationId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      actorRole: "user",
      environment: "development",
      requestedOperation: "request_football_intelligence",
    });
    expect(context.telegramUserId).toBeUndefined();
    expect(context.subjectReference).toBeUndefined();
    expect(context.snapshotTime).toBeUndefined();
    expect(context.idempotencyKey).toBeUndefined();
  });

  it("uses the injected clock deterministically for tests", () => {
    const context = buildAgentExecutionContext({
      invocationId: "11111111-1111-1111-1111-111111111111",
      correlationId: "22222222-2222-2222-2222-222222222222",
      actorUserId: "33333333-3333-3333-3333-333333333333",
      actorRole: "user",
      environment: "development",
      requestedOperation: "request_football_intelligence",
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(context.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
