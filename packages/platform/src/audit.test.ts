import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "./audit.js";

describe("InMemoryAuditService", () => {
  it("records an event and returns it with a generated id and timestamp", async () => {
    const service = new InMemoryAuditService();
    const event = await service.record({ actor: "user-1", action: "login", resource: "session", resourceId: "s-1", outcome: AuditOutcome.SUCCESS, requestId: "req-1" });
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });

  it("accumulates events in recording order and never fabricates entries that were not recorded", async () => {
    const service = new InMemoryAuditService();
    await service.record({ actor: "user-1", action: "login", resource: "session", resourceId: "s-1", outcome: AuditOutcome.SUCCESS, requestId: "req-1" });
    await service.record({ actor: "user-1", action: "execution_rejected", resource: "agent", resourceId: "agent-1", outcome: AuditOutcome.DENIED, requestId: "req-2" });

    const events = service.getEvents();

    expect(events).toHaveLength(2);
    expect(events[0]?.action).toBe("login");
    expect(events[1]?.action).toBe("execution_rejected");
  });

  it("getEvents() returns a snapshot that cannot be used to mutate internal state", async () => {
    const service = new InMemoryAuditService();
    await service.record({ actor: "user-1", action: "login", resource: "session", resourceId: "s-1", outcome: AuditOutcome.SUCCESS, requestId: "req-1" });

    const snapshot = service.getEvents() as unknown[];
    snapshot.push({ fabricated: true });

    expect(service.getEvents()).toHaveLength(1);
  });

  it("carries metadata through unmodified", async () => {
    const service = new InMemoryAuditService();
    const event = await service.record({
      actor: "user-1",
      action: "license_changed",
      resource: "license",
      resourceId: "lic-1",
      outcome: AuditOutcome.SUCCESS,
      requestId: "req-1",
      metadata: { from: "trial", to: "active" },
    });
    expect(event.metadata).toEqual({ from: "trial", to: "active" });
  });
});
