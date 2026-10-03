import { describe, expect, it } from "vitest";
import { createTelegramWebAppClient } from "./TelegramWebAppClient.js";

/**
 * Runs under vitest's default "node" environment, where `window` is
 * genuinely undefined — the same real fallback path a plain (non-
 * Telegram) browser dev session takes (Section 09 §38 — "provide
 * sensible fallback values"). No jsdom stub involved: this exercises the
 * actual "Telegram absent" branch of `BrowserTelegramWebAppClient`.
 */
describe("TelegramWebAppClient outside Telegram", () => {
  it("reports itself unavailable rather than fabricating a session", () => {
    const client = createTelegramWebAppClient();
    expect(client.isAvailable).toBe(false);
    expect(client.getRawInitData()).toBe("");
  });

  it("never invents a color scheme or theme colors — returns undefined/empty so the caller falls back to CSS defaults", () => {
    const client = createTelegramWebAppClient();
    expect(client.getColorScheme()).toBeUndefined();
    expect(client.getThemeParams()).toEqual({});
  });

  it("ready()/expand() never throw when there is no Telegram bridge to call", () => {
    const client = createTelegramWebAppClient();
    expect(() => client.ready()).not.toThrow();
    expect(() => client.expand()).not.toThrow();
  });
});
