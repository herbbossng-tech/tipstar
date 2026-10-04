// Shared fixed-window in-memory rate limiter for Supabase Edge
// Functions (Deno runtime) — Section 02 established this pattern in
// `telegram-auth/index.ts`; Section 12 extracts it here so the admin
// mutation endpoints (`admin-jobs`/`admin-reports`) reuse the exact
// same logic rather than a third independent copy.
//
// Scoped to a single warm isolate — this is NOT sufficient on its own
// for a distributed edge deployment (concurrent/cold isolates don't
// share this Map; see `packages/shared/src/rate-limit.ts` for the same
// documented caveat on the Node side). It is defense in depth, not the
// primary control: the primary control for every endpoint this guards
// remains real authentication + authorization, never this limiter.

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface FixedWindowRateLimiter {
  /** Returns true if the call is allowed, false if the key has exceeded its window limit. */
  check(key: string): boolean;
}

export function createFixedWindowRateLimiter(maxRequests: number, windowSeconds: number): FixedWindowRateLimiter {
  const state = new Map<string, RateLimitEntry>();
  return {
    check(key: string): boolean {
      const nowSeconds = Date.now() / 1000;
      const entry = state.get(key);
      if (!entry || nowSeconds - entry.windowStart >= windowSeconds) {
        state.set(key, { count: 1, windowStart: nowSeconds });
        return true;
      }
      if (entry.count >= maxRequests) {
        return false;
      }
      entry.count += 1;
      return true;
    },
  };
}
