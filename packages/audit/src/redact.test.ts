import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("redacts keys that look like secrets, recursively", () => {
    const result = redact({
      userId: "user-1",
      telegramBotToken: "123:abc",
      nested: { apiKey: "sk-secret", safeField: "ok" },
    }) as Record<string, unknown>;

    expect(result.userId).toBe("user-1");
    expect(result.telegramBotToken).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).safeField).toBe("ok");
  });

  it("leaves non-sensitive primitive values untouched", () => {
    expect(redact(42)).toBe(42);
    expect(redact("hello")).toBe("hello");
  });
});
