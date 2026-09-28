import { describe, expect, it } from "vitest";
import { issueAuthSession, verifyAuthSession } from "./session.js";
import type { AuthenticatedTelegramIdentity } from "./types.js";

const SECRET = "test-session-signing-secret-do-not-use-in-production";

function buildIdentity(overrides: Partial<AuthenticatedTelegramIdentity> = {}): AuthenticatedTelegramIdentity {
  return {
    telegramUserId: 42,
    firstName: "Ada",
    lastName: undefined,
    username: "ada",
    languageCode: "en",
    isPremium: false,
    authDate: "2026-01-01T00:00:00.000Z",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    authMode: "telegram",
    ...overrides,
  };
}

describe("issueAuthSession / verifyAuthSession", () => {
  it("issues a session and verifies it round-trip", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const identity = buildIdentity();

    const issued = issueAuthSession(identity, SECRET, 3600, now);
    const verified = verifyAuthSession(issued.token, SECRET, now);

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.telegramUserId).toBe(42);
      expect(verified.value.sessionId).toBe(issued.session.sessionId);
    }
  });

  it("rejects a tampered token payload", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600, now);
    const [payload, signature] = issued.token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload as string, "base64url").toString("utf8")), telegramUserId: 999 })).toString(
      "base64url",
    );
    const tamperedToken = `${tamperedPayload}.${signature}`;

    const result = verifyAuthSession(tamperedToken, SECRET, now);

    expect(result.ok).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600, now);

    const result = verifyAuthSession(issued.token, "a-completely-different-secret", now);

    expect(result.ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = issueAuthSession(buildIdentity(), SECRET, 60, now);
    const later = new Date(now.getTime() + 120_000);

    const result = verifyAuthSession(issued.token, SECRET, later);

    expect(result.ok).toBe(false);
  });

  it("rejects a malformed token", () => {
    const result = verifyAuthSession("not-a-valid-token", SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects a token with an unparseable payload", () => {
    const bogusPayload = Buffer.from("not json").toString("base64url");
    const bogusToken = `${bogusPayload}.${"a".repeat(43)}`;

    const result = verifyAuthSession(bogusToken, SECRET);

    expect(result.ok).toBe(false);
  });

  it("never embeds the raw identity beyond the documented AuthSession fields", () => {
    const issued = issueAuthSession(buildIdentity({ username: "secret-should-not-leak-as-is" }), SECRET, 3600);
    const decodedPayload = JSON.parse(Buffer.from(issued.token.split(".")[0] as string, "base64url").toString("utf8"));

    expect(Object.keys(decodedPayload).sort()).toEqual(["authenticatedAt", "expiresAt", "issuedAt", "sessionId", "telegramUserId"].sort());
  });
});
