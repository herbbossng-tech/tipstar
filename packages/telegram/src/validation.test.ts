import { describe, expect, it } from "vitest";
import { TelegramDestinationType, type TelegramDestination } from "./types.js";
import { validateTelegramDestination } from "./validation.js";

function buildDestination(overrides: Partial<TelegramDestination> = {}): TelegramDestination {
  return {
    destinationId: "dest-1",
    telegramChatId: "-1001234567890",
    name: "Main Channel",
    type: TelegramDestinationType.CHANNEL,
    enabled: true,
    autoPublish: true,
    publishBookingCode: true,
    publishTicket: true,
    publishResults: true,
    publishWeeklyReport: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateTelegramDestination", () => {
  it("accepts a well-formed destination", () => {
    const result = validateTelegramDestination(buildDestination());
    expect(result.ok).toBe(true);
  });

  it("rejects a missing name", () => {
    const result = validateTelegramDestination(buildDestination({ name: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric telegramChatId", () => {
    const result = validateTelegramDestination(buildDestination({ telegramChatId: "not-a-chat-id" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a negative telegramChatId (channels/supergroups)", () => {
    const result = validateTelegramDestination(buildDestination({ telegramChatId: "-100987654321" }));
    expect(result.ok).toBe(true);
  });

  it("rejects an unrecognized destination type", () => {
    const result = validateTelegramDestination(buildDestination({ type: "broadcast" as TelegramDestinationType }));
    expect(result.ok).toBe(false);
  });

  it("rejects a disabled destination with autoPublish still enabled", () => {
    const result = validateTelegramDestination(buildDestination({ enabled: false, autoPublish: true }));
    expect(result.ok).toBe(false);
  });

  it("accepts a disabled destination once autoPublish is also off", () => {
    const result = validateTelegramDestination(buildDestination({ enabled: false, autoPublish: false }));
    expect(result.ok).toBe(true);
  });
});
