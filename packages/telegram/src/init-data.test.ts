import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateInitData } from "./init-data.js";

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
    const initData = buildSignedInitData(
      {
        auth_date: String(authDate),
        query_id: "AAAA",
        user: JSON.stringify({ id: 42, first_name: "Ada" }),
      },
      BOT_TOKEN,
    );

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
    const initData = buildSignedInitData(
      { auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada" }) },
      BOT_TOKEN,
    );
    const tampered = initData.replace("Ada", "Eve");

    const result = validateInitData(tampered, BOT_TOKEN, { maxAgeSeconds: 86400, now });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TELEGRAM_AUTH_INVALID");
    }
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
    if (!result.ok) {
      expect(result.error.code).toBe("TELEGRAM_AUTH_EXPIRED");
    }
  });

  it("rejects a payload with a missing hash", () => {
    const result = validateInitData("auth_date=123&user=%7B%7D", BOT_TOKEN, { maxAgeSeconds: 86400 });
    expect(result.ok).toBe(false);
  });
});
