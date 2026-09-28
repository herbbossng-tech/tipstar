import { describe, expect, it } from "vitest";
import { InMemoryFixedWindowRateLimiter } from "./rate-limit.js";

describe("InMemoryFixedWindowRateLimiter", () => {
  it("allows requests up to the configured limit within a window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryFixedWindowRateLimiter({ maxRequests: 3, windowSeconds: 60, now: () => now });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(true);
  });

  it("denies the request once the limit is exceeded within the window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryFixedWindowRateLimiter({ maxRequests: 2, windowSeconds: 60, now: () => now });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(true);
    const third = limiter.check("user-1");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets once the window elapses", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryFixedWindowRateLimiter({ maxRequests: 1, windowSeconds: 60, now: () => now });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);

    now = new Date(now.getTime() + 61_000);
    expect(limiter.check("user-1").allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const limiter = new InMemoryFixedWindowRateLimiter({ maxRequests: 1, windowSeconds: 60, now: () => now });

    expect(limiter.check("user-1").allowed).toBe(true);
    expect(limiter.check("user-2").allowed).toBe(true);
    expect(limiter.check("user-1").allowed).toBe(false);
  });
});
