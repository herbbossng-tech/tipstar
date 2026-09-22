import { describe, expect, it } from "vitest";
import { issueSessionToken, verifySessionToken } from "./jwt.js";

const SECRET = "test-jwt-secret-do-not-use-in-production";
const CLAIMS = {
  sub: "11111111-1111-1111-1111-111111111111",
  role: "authenticated" as const,
  tipstar_user_id: "11111111-1111-1111-1111-111111111111",
  telegram_user_id: 42,
};

describe("issueSessionToken / verifySessionToken", () => {
  it("round-trips valid claims", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = issueSessionToken(CLAIMS, SECRET, 3600, now);

    const result = verifySessionToken(session.accessToken, SECRET, now);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tipstar_user_id).toBe(CLAIMS.tipstar_user_id);
      expect(result.value.telegram_user_id).toBe(42);
      expect(result.value.role).toBe("authenticated");
    }
  });

  it("rejects a token signed with a different secret", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = issueSessionToken(CLAIMS, SECRET, 3600, now);

    const result = verifySessionToken(session.accessToken, "a-completely-different-secret", now);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_INVALID");
  });

  it("rejects a token with a tampered payload", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const session = issueSessionToken(CLAIMS, SECRET, 3600, now);
    const [header, , signature] = session.accessToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...CLAIMS, tipstar_user_id: "22222222-2222-2222-2222-222222222222", iat: 0, exp: 999999999999 }),
    ).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const result = verifySessionToken(tampered, SECRET, now);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_INVALID");
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const session = issueSessionToken(CLAIMS, SECRET, 60, issuedAt);
    const later = new Date(issuedAt.getTime() + 10 * 60 * 1000);

    const result = verifySessionToken(session.accessToken, SECRET, later);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_EXPIRED");
  });

  it("rejects a malformed token", () => {
    const result = verifySessionToken("not-a-jwt", SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_INVALID");
  });

  it("rejects a token with an unsupported structure (alg-none style truncation)", () => {
    const result = verifySessionToken("header.payload", SECRET);
    expect(result.ok).toBe(false);
  });
});
