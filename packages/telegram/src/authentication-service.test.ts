import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DefaultTelegramAuthenticationService } from "./authentication-service.js";
import { TelegramAuthErrorCode } from "./types.js";

const BOT_TOKEN = "123456:TEST-bot-token-for-unit-tests-only";

function buildSignedInitData(fields: Record<string, string>, botToken: string = BOT_TOKEN): string {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function freshInitData(overrides: Record<string, string> = {}, botToken: string = BOT_TOKEN, now: Date = new Date()) {
  const authDate = Math.floor(now.getTime() / 1000) - 10;
  return buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada" }), ...overrides }, botToken);
}

describe("DefaultTelegramAuthenticationService", () => {
  it("authenticates a valid initData payload and extracts the user", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    const result = await service.authenticate(freshInitData());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.telegramUserId).toBe(42);
      expect(result.value.firstName).toBe("Ada");
      expect(result.value.username).toBe("ada");
      expect(result.value.authMode).toBe("telegram");
    }
  });

  it("rejects an invalid hash", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const tampered = freshInitData().replace(/hash=[0-9a-f]+/, "hash=0000000000000000000000000000000000000000000000000000000000000000");

    const result = await service.authenticate(tampered);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects modified user data", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const tampered = freshInitData().replace("Ada", "Eve");

    const result = await service.authenticate(tampered);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects a modified auth_date", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = freshInitData({}, BOT_TOKEN, now).replace(`auth_date=${authDate}`, `auth_date=${authDate - 3}`);

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects a payload with a missing hash", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    const result = await service.authenticate("auth_date=123&user=%7B%22id%22%3A42%7D");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects a payload missing auth_date", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const initData = buildSignedInitData({ user: JSON.stringify({ id: 42 }) });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_MALFORMED);
    }
  });

  it("rejects a payload with a malformed auth_date", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const initData = buildSignedInitData({ auth_date: "not-a-number" });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_MALFORMED);
    }
  });

  it("rejects an expired payload", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 200_000;
    const initData = buildSignedInitData({ auth_date: String(authDate) });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_EXPIRED);
    }
  });

  it("rejects an auth_date beyond the configured future clock skew", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const authDate = Math.floor(Date.now() / 1000) + 600;
    const initData = buildSignedInitData({ auth_date: String(authDate) });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_EXPIRED);
    }
  });

  it("accepts a valid auth_date within the configured clock skew", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const authDate = Math.floor(Date.now() / 1000) + 20;
    const initData = buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 7, first_name: "Grace" }) });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(true);
  });

  it("rejects a payload with no user", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const authDate = Math.floor(Date.now() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate) });

    const result = await service.authenticate(initData);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.USER_MISSING);
    }
  });

  it("never includes the bot token in a successful result", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    const result = await service.authenticate(freshInitData());

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });

  it("never includes the bot token in a failure result", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const tampered = freshInitData().replace("Ada", "Eve");

    const result = await service.authenticate(tampered);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });

  it("rejects with a not-configured error when no bot token is set", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: undefined, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    const result = await service.authenticate(freshInitData());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.AUTH_NOT_CONFIGURED);
    }
  });

  it("rejects empty initData", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    const result = await service.authenticate("");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_MISSING);
    }
  });
});
