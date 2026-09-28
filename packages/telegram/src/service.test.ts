import { describe, expect, it, vi } from "vitest";
import { NotImplementedError } from "@sport-os/shared";
import { NotImplementedPublishingService, NotImplementedTelegramDestinationManager, TelegramBotApiService } from "./service.js";

function mockFetch(response: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => response } as Response);
}

describe("TelegramBotApiService", () => {
  it("returns a successful result on a valid Telegram API response", async () => {
    const fetchImpl = mockFetch({ ok: true, result: { message_id: 101 } });
    const service = new TelegramBotApiService({ botToken: "test-token", fetchImpl });

    const result = await service.sendMessage("-100123", "hello");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.messageId).toBe(101);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.telegram.org/bottest-token/sendMessage"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("never leaks the bot token into the returned error on failure", async () => {
    const fetchImpl = mockFetch({ ok: false, description: "chat not found" }, false);
    const service = new TelegramBotApiService({ botToken: "super-secret-token", fetchImpl });

    const result = await service.sendMessage("-100123", "hello");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error.toJSON())).not.toContain("super-secret-token");
    }
  });

  it("returns an IntegrationError (not a thrown exception) when the network call itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const service = new TelegramBotApiService({ botToken: "test-token", fetchImpl });

    const result = await service.sendMessage("-100123", "hello");

    expect(result.ok).toBe(false);
  });

  it("replyToMessage includes reply_to_message_id in the request body", async () => {
    const fetchImpl = mockFetch({ ok: true, result: { message_id: 5 } });
    const service = new TelegramBotApiService({ botToken: "test-token", fetchImpl });

    await service.replyToMessage("-100123", 99, "reply text");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.reply_to_message_id).toBe(99);
  });
});

describe("not-implemented service boundaries", () => {
  it("PublishingService.publish throws NotImplementedError rather than faking a send", async () => {
    await expect(new NotImplementedPublishingService().publish("dest-1", "content")).rejects.toThrow(NotImplementedError);
  });

  it("TelegramDestinationManager methods throw NotImplementedError rather than returning fabricated destinations", async () => {
    const manager = new NotImplementedTelegramDestinationManager();
    await expect(manager.list()).rejects.toThrow(NotImplementedError);
    await expect(manager.get("dest-1")).rejects.toThrow(NotImplementedError);
  });
});
