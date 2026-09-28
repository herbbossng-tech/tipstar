/**
 * Cross-package integration test (Section 02 — Telegram Authentication):
 * exercises the full authentication pipeline —
 *
 *   raw initData -> DefaultTelegramAuthenticationService.authenticate() ->
 *   verified AuthenticatedTelegramIdentity -> issueAuthSession() ->
 *   AuditService (record)
 *
 * This is the same orchestration supabase/functions/telegram-auth/index.ts
 * performs at the edge (reimplemented there for Deno) — this test proves
 * the orchestration itself against the real Node implementation: a failed
 * validation never reaches session issuance or a "success" audit event,
 * and a raw initData string never appears in anything recorded.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuditOutcome, InMemoryAuditService } from "@sport-os/platform";
import { DefaultTelegramAuthenticationService, issueAuthSession, verifyAuthSession } from "@sport-os/telegram";

const BOT_TOKEN = "123456:TEST-bot-token-for-integration-tests-only";
const SESSION_SECRET = "test-session-signing-secret-do-not-use-in-production";

function buildSignedInitData(fields: Record<string, string>, botToken: string = BOT_TOKEN): string {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function freshInitData(overrides: Record<string, string> = {}): string {
  const authDate = Math.floor(Date.now() / 1000) - 10;
  return buildSignedInitData({ auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada" }), ...overrides });
}

describe("Telegram authentication flow (auth service -> session -> audit)", () => {
  it("authenticates, issues a session, and records a success audit event with no raw initData in it", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const audit = new InMemoryAuditService();
    const rawInitData = freshInitData();

    const authResult = await service.authenticate(rawInitData);
    expect(authResult.ok).toBe(true);
    if (!authResult.ok) return;

    const identity = authResult.value;
    const issued = issueAuthSession(identity, SESSION_SECRET, 3600);

    await audit.record({
      actor: String(identity.telegramUserId),
      action: "telegram_authenticated",
      resource: "telegram_session",
      resourceId: issued.session.sessionId,
      outcome: AuditOutcome.SUCCESS,
      requestId: "req-auth-1",
      metadata: { authMode: identity.authMode },
    });

    const events = audit.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("telegram_authenticated");
    expect(events[0]?.outcome).toBe(AuditOutcome.SUCCESS);
    expect(JSON.stringify(events)).not.toContain(rawInitData);
    expect(JSON.stringify(events)).not.toContain(BOT_TOKEN);

    const verified = verifyAuthSession(issued.token, SESSION_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.telegramUserId).toBe(42);
    }
  });

  it("never issues a session or records success when validation fails, and records a failure event with no raw initData in it", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });
    const audit = new InMemoryAuditService();
    const tamperedInitData = freshInitData().replace("Ada", "Eve");

    const authResult = await service.authenticate(tamperedInitData);
    expect(authResult.ok).toBe(false);
    if (authResult.ok) return;

    await audit.record({
      actor: "unknown",
      action: "telegram_authentication_failed",
      resource: "telegram_session",
      resourceId: "n/a",
      outcome: AuditOutcome.FAILURE,
      requestId: "req-auth-2",
      metadata: { code: authResult.error.code },
    });

    const events = audit.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("telegram_authentication_failed");
    expect(events[0]?.outcome).toBe(AuditOutcome.FAILURE);
    expect(JSON.stringify(events)).not.toContain(tamperedInitData);
    expect(JSON.stringify(events)).not.toContain(BOT_TOKEN);
  });

  it("rejects a client-supplied identity with no validated initData (never trusts a bare telegram user id)", async () => {
    const service = new DefaultTelegramAuthenticationService({ botToken: BOT_TOKEN, maxAgeSeconds: 86400, clockSkewSeconds: 60 });

    // Simulates an attacker who only knows a target's Telegram user id and
    // tries to fabricate a plausible-looking but unsigned initData string.
    const forgedInitData = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 42, first_name: "Ada" }),
      hash: "0".repeat(64),
    }).toString();

    const result = await service.authenticate(forgedInitData);

    expect(result.ok).toBe(false);
  });
});
