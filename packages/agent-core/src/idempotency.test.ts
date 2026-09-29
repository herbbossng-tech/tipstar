import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "./idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("a first claim wins and is returned as-is", async () => {
    const store = new InMemoryIdempotencyStore();
    const claim = await store.claim("telegram_channel_management", "publish-42", "11111111-1111-1111-1111-111111111111");
    expect(claim.invocationId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("a second claim with the same (agentType, key) returns the ORIGINAL winner, not the new attempt — this is what makes duplicate execution impossible", async () => {
    const store = new InMemoryIdempotencyStore();
    const first = await store.claim("telegram_channel_management", "publish-42", "11111111-1111-1111-1111-111111111111");
    const second = await store.claim("telegram_channel_management", "publish-42", "22222222-2222-2222-2222-222222222222");
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.invocationId).not.toBe("22222222-2222-2222-2222-222222222222");
  });

  it("the same key string under a DIFFERENT agentType is an independent claim", async () => {
    const store = new InMemoryIdempotencyStore();
    const footballClaim = await store.claim("football_automation", "shared-key", "11111111-1111-1111-1111-111111111111");
    const aviatorClaim = await store.claim("aviator_automation", "shared-key", "22222222-2222-2222-2222-222222222222");
    expect(footballClaim.invocationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(aviatorClaim.invocationId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("get() returns undefined for an unclaimed key", async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get("football_automation", "never-claimed")).toBeUndefined();
  });
});
