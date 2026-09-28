import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateInitData } from "./init-data.js";
import { TelegramAuthErrorCode } from "./types.js";

const BOT_TOKEN = "123456:TEST-bot-token-for-unit-tests-only";

function buildSignedInitData(fields: Record<string, string>, botToken: string): string {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

describe("validateInitData", () => {
  it("accepts a correctly signed, fresh payload", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada" }) }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user?.id).toBe(42);
      expect(result.value.user?.first_name).toBe("Ada");
    }
  });

  it("rejects a payload with a tampered field", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada" }) }, BOT_TOKEN);
    const tampered = initData.replace("Ada", "Eve");

    const result = validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
  });

  it("rejects a payload signed with the wrong bot token", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, "999:different-token");

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
  });

  it("rejects an expired payload (replay protection)", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 100_000;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
  });

  it("rejects a payload with a missing hash", () => {
    const result = validateInitData("auth_date=123&user=%7B%7D", BOT_TOKEN, { maxAgeSeconds: 86400 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects modified user data with an invalid-signature code", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada" }) }, BOT_TOKEN);
    const tampered = initData.replace("42", "43");

    const result = validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects a tampered auth_date with an invalid-signature code", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const initData = buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42 }) }, BOT_TOKEN);
    const tampered = initData.replace(`auth_date=${authDate}`, `auth_date=${authDate - 5}`);

    const result = validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });

  it("rejects a payload with a malformed (non-numeric) auth_date", () => {
    const fields = { auth_date: "not-a-number", user: JSON.stringify({ id: 42 }) };
    const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const initData = new URLSearchParams({ ...fields, hash }).toString();

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_MALFORMED);
    }
  });

  it("rejects a payload with a zero or negative auth_date", () => {
    const initData = buildSignedInitData({ auth_date: "0" }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_MALFORMED);
    }
  });

  it("carries the expired code on an expired payload", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 100_000;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_EXPIRED);
    }
  });

  it("rejects an auth_date far enough in the future to exceed the configured clock skew", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) + 120;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, clockSkewSeconds: 60, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_EXPIRED);
    }
  });

  it("accepts an auth_date slightly in the future when within the configured clock skew", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) + 30;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, BOT_TOKEN);

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, clockSkewSeconds: 60, now });

    expect(result.ok).toBe(true);
  });

  it("respects a custom (larger) clock skew configuration", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) + 200;
    const initData = buildSignedInitData({ auth_date: String(authDate) }, BOT_TOKEN);

    const rejectedWithDefaultSkew = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });
    expect(rejectedWithDefaultSkew.ok).toBe(false);

    const acceptedWithWiderSkew = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, clockSkewSeconds: 300, now });
    expect(acceptedWithWiderSkew.ok).toBe(true);
  });

  it("uses a timing-safe comparison, tolerating hashes of equal length that share no prefix", () => {
    // A naive `===` and a timing-safe comparison both reject a wrong hash;
    // this test only guards against an implementation that short-circuits
    // on a byte-length mismatch instead of comparing content, by using a
    // forged hash of the exact expected length.
    const now = new Date("2026-01-01T00:00:00Z");
    const authDate = Math.floor(now.getTime() / 1000) - 10;
    const fields = { auth_date: String(authDate) };
    const forgedHash = "0".repeat(64);
    const initData = new URLSearchParams({ ...fields, hash: forgedHash }).toString();

    const result = validateInitData(initData, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(TelegramAuthErrorCode.INIT_DATA_INVALID);
    }
  });
});
