import { describe, expect, it } from "vitest";
import { StructuredLogger, type LogEntry } from "./logger.js";

function collectingLogger(minSeverity?: "debug" | "info" | "warn" | "error") {
  const entries: LogEntry[] = [];
  const logger = new StructuredLogger({
    environment: "development",
    service: "test-service",
    ...(minSeverity !== undefined ? { minSeverity } : {}),
    sink: (e) => entries.push(e),
  });
  return { logger, entries };
}

describe("StructuredLogger", () => {
  it("produces entries with the required structured shape", () => {
    const { logger, entries } = collectingLogger();
    logger.info("hello", { foo: "bar" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      environment: "development",
      service: "test-service",
      severity: "info",
      message: "hello",
      metadata: { foo: "bar" },
    });
    expect(entries[0]?.timestamp).toBeTruthy();
  });

  it("never logs secret-shaped fields in metadata", () => {
    const { logger, entries } = collectingLogger();
    logger.error("auth failed", {
      TELEGRAM_BOT_TOKEN: "123:abc",
      apiKey: "sk-live-123",
      password: "hunter2",
      userId: "user-1",
    });
    const metadata = entries[0]?.metadata as Record<string, unknown>;
    expect(metadata.TELEGRAM_BOT_TOKEN).toBe("[REDACTED]");
    expect(metadata.apiKey).toBe("[REDACTED]");
    expect(metadata.password).toBe("[REDACTED]");
    expect(metadata.userId).toBe("user-1");
  });

  it("redacts secrets nested inside metadata objects/arrays", () => {
    const { logger, entries } = collectingLogger();
    logger.warn("nested", { config: { supabase: { serviceRoleKey: "very-secret" } }, list: [{ token: "abc" }] });
    const metadata = entries[0]?.metadata as Record<string, unknown>;
    const config = metadata.config as { supabase: { serviceRoleKey: string } };
    expect(config.supabase.serviceRoleKey).toBe("[REDACTED]");
    const list = metadata.list as Array<{ token: string }>;
    expect(list[0]?.token).toBe("[REDACTED]");
  });

  it("filters out entries below the configured minimum severity", () => {
    const { logger, entries } = collectingLogger("warn");
    logger.debug("noisy");
    logger.info("still noisy");
    logger.warn("important");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("important");
  });

  it("withRequestId() binds a correlation ID onto every subsequent entry", () => {
    const { logger, entries } = collectingLogger();
    const bound = logger.withRequestId("req-42");
    bound.info("correlated");
    expect(entries[0]?.requestId).toBe("req-42");
  });
});
