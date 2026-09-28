import { describe, expect, it } from "vitest";
import { issueAuthSession } from "./session.js";
import { hashSessionToken, InMemoryAuthSessionStore, verifyAuthSessionWithRevocation } from "./session-store.js";
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

describe("verifyAuthSessionWithRevocation", () => {
  it("succeeds for a persisted, non-revoked, unexpired session", async () => {
    const store = new InMemoryAuthSessionStore();
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600);
    await store.persist({ userId: "user-1", session: issued.session, tokenHash: hashSessionToken(issued.token) });

    const result = await verifyAuthSessionWithRevocation(issued.token, SECRET, store);

    expect(result.ok).toBe(true);
  });

  it("fails closed for a session that was never persisted", async () => {
    const store = new InMemoryAuthSessionStore();
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600);
    // Deliberately not persisted.

    const result = await verifyAuthSessionWithRevocation(issued.token, SECRET, store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REVOKED");
  });

  it("fails after the session is explicitly revoked", async () => {
    const store = new InMemoryAuthSessionStore();
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600);
    await store.persist({ userId: "user-1", session: issued.session, tokenHash: hashSessionToken(issued.token) });
    await store.revoke(issued.session.sessionId, "user requested logout");

    const result = await verifyAuthSessionWithRevocation(issued.token, SECRET, store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REVOKED");
  });

  it("revokeAllForUser revokes every session for that user, and only that user", async () => {
    const store = new InMemoryAuthSessionStore();
    const issuedA1 = issueAuthSession(buildIdentity(), SECRET, 3600);
    const issuedA2 = issueAuthSession(buildIdentity(), SECRET, 3600);
    const issuedB = issueAuthSession(buildIdentity({ telegramUserId: 99 }), SECRET, 3600);
    await store.persist({ userId: "user-a", session: issuedA1.session, tokenHash: hashSessionToken(issuedA1.token) });
    await store.persist({ userId: "user-a", session: issuedA2.session, tokenHash: hashSessionToken(issuedA2.token) });
    await store.persist({ userId: "user-b", session: issuedB.session, tokenHash: hashSessionToken(issuedB.token) });

    await store.revokeAllForUser("user-a", "forced logout");

    expect((await verifyAuthSessionWithRevocation(issuedA1.token, SECRET, store)).ok).toBe(false);
    expect((await verifyAuthSessionWithRevocation(issuedA2.token, SECRET, store)).ok).toBe(false);
    expect((await verifyAuthSessionWithRevocation(issuedB.token, SECRET, store)).ok).toBe(true);
  });

  it("rejects a token presented against a stored session whose hash doesn't match (defense in depth against a forged sessionId)", async () => {
    const store = new InMemoryAuthSessionStore();
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600);
    await store.persist({ userId: "user-1", session: issued.session, tokenHash: "not-the-real-hash" });

    const result = await verifyAuthSessionWithRevocation(issued.token, SECRET, store);

    expect(result.ok).toBe(false);
  });

  it("still rejects an invalid signature before ever consulting the store (stateless check runs first)", async () => {
    const store = new InMemoryAuthSessionStore();
    const issued = issueAuthSession(buildIdentity(), SECRET, 3600);
    const tampered = `${issued.token.split(".")[0]}.tamperedsignature`;

    const result = await verifyAuthSessionWithRevocation(tampered, SECRET, store);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).not.toBe("SESSION_REVOKED");
  });
});

describe("hashSessionToken", () => {
  it("is deterministic and never returns the raw token", () => {
    const token = "abc.def";
    const hash = hashSessionToken(token);
    expect(hash).not.toBe(token);
    expect(hash).toBe(hashSessionToken(token));
  });
});
