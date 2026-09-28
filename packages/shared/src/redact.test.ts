import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("redacts raw Telegram initData regardless of key casing/style", () => {
    const result = redact({ initData: "auth_date=123&hash=abc", raw_init_data: "auth_date=456&hash=def", rawInitData: "x" }) as Record<
      string,
      unknown
    >;
    expect(result.initData).toBe("[REDACTED]");
    expect(result.raw_init_data).toBe("[REDACTED]");
    expect(result.rawInitData).toBe("[REDACTED]");
  });

  it("still redacts the pre-existing secret-shaped keys", () => {
    const result = redact({ botToken: "123:abc", TELEGRAM_BOT_TOKEN: "123:abc", password: "x" }) as Record<string, unknown>;
    expect(result.botToken).toBe("[REDACTED]");
    expect(result.TELEGRAM_BOT_TOKEN).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
  });

  it("redacts license keys regardless of key casing/style (Section 03)", () => {
    const result = redact({ licenseKey: "LIC-abc", license_key: "LIC-abc", fullLicenseKey: "LIC-abc" }) as Record<string, unknown>;
    expect(result.licenseKey).toBe("[REDACTED]");
    expect(result.license_key).toBe("[REDACTED]");
    expect(result.fullLicenseKey).toBe("[REDACTED]");
  });

  it("leaves non-sensitive keys, including a safe telegramUserId, untouched", () => {
    const result = redact({ telegramUserId: 12345, username: "ada" }) as Record<string, unknown>;
    expect(result.telegramUserId).toBe(12345);
    expect(result.username).toBe("ada");
  });
});
