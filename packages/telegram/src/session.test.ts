import { describe, expect, it } from "vitest";
import { InMemoryUserIdentityRepository } from "./in-memory-user-repository.js";
import { resolveOrCreateSession } from "./session.js";
import type { TelegramWebAppUser } from "./types.js";

const TELEGRAM_USER: TelegramWebAppUser = {
  id: 42,
  first_name: "Ada",
  last_name: "Lovelace",
  username: "ada",
  language_code: "en",
};

describe("resolveOrCreateSession", () => {
  it("creates exactly one user the first time a Telegram id is seen", async () => {
    const repository = new InMemoryUserIdentityRepository();

    const result = await resolveOrCreateSession(TELEGRAM_USER, repository);

    expect(result.ok).toBe(true);
    expect(repository.createCallCount).toBe(1);
    if (result.ok) {
      expect(result.value.telegramIdentity.telegramUserId).toBe(42);
    }
  });

  it("is idempotent: opening the Mini App repeatedly never creates duplicate users", async () => {
    const repository = new InMemoryUserIdentityRepository();

    const first = await resolveOrCreateSession(TELEGRAM_USER, repository);
    const second = await resolveOrCreateSession(TELEGRAM_USER, repository);
    const third = await resolveOrCreateSession(TELEGRAM_USER, repository);

    expect(repository.createCallCount).toBe(1);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(second.value.user.id).toBe(first.value.user.id);
      expect(third.value.user.id).toBe(first.value.user.id);
    }
  });

  it("resolves distinct users for distinct Telegram ids", async () => {
    const repository = new InMemoryUserIdentityRepository();
    const other: TelegramWebAppUser = { id: 99, first_name: "Grace" };

    const first = await resolveOrCreateSession(TELEGRAM_USER, repository);
    const second = await resolveOrCreateSession(other, repository);

    expect(repository.createCallCount).toBe(2);
    if (first.ok && second.ok) {
      expect(first.value.user.id).not.toBe(second.value.user.id);
    }
  });
});
