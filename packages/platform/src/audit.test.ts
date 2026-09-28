import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService, SupabaseAuditService } from "./audit.js";
import type { SupabaseClient } from "./db/client.js";

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

describe("SupabaseAuditService", () => {
  function fakeClient(insertSpy: (table: string, payload: unknown) => { error: null | { message: string } }): SupabaseClient {
    return {
      from(table: string) {
        return {
          insert(payload: unknown) {
            return Promise.resolve(insertSpy(table, payload));
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("redacts secret-shaped metadata (e.g. a full license key) before it is ever written to audit_logs", async () => {
    let inserted: Record<string, unknown> | undefined;
    const client = fakeClient((table, payload) => {
      inserted = payload as Record<string, unknown>;
      expect(table).toBe("audit_logs");
      return { error: null };
    });
    const service = new SupabaseAuditService(client);

    await service.record({
      actor: "user-1",
      action: "license_created",
      resource: "license",
      resourceId: "license-1",
      outcome: AuditOutcome.SUCCESS,
      requestId: "req-1",
      metadata: { licenseKey: "LIC-super-secret-value", plan: "pro" },
    });

    const metadata = inserted?.metadata as Record<string, unknown>;
    expect(metadata.licenseKey).toBe("[REDACTED]");
    expect(metadata.plan).toBe("pro");
  });

  it("writes to the audit_logs table with the expected row shape", async () => {
    let inserted: Record<string, unknown> | undefined;
    const client = fakeClient((_table, payload) => {
      inserted = payload as Record<string, unknown>;
      return { error: null };
    });
    const service = new SupabaseAuditService(client);

    const event = await service.record({ actor: "user-1", action: "role_changed", resource: "user", resourceId: "user-2", outcome: AuditOutcome.SUCCESS, requestId: "req-1" });

    expect(inserted).toMatchObject({ actor_user_id: "user-1", action: "role_changed", resource_type: "user", resource_id: "user-2", outcome: AuditOutcome.SUCCESS, request_id: "req-1" });
    expect(event.id).toBeTruthy();
  });

  it("throws a typed error, rather than silently swallowing, when the insert fails", async () => {
    const client = fakeClient(() => ({ error: { message: "connection refused" } }));
    const service = new SupabaseAuditService(client);

    await expect(service.record({ actor: "user-1", action: "x", resource: "y", resourceId: "z", outcome: AuditOutcome.SUCCESS, requestId: "req-1" })).rejects.toThrow();
  });
});
