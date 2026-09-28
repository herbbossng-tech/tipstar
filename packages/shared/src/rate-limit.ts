/**
 * Rate limiting boundary (Section 02 — Authentication Endpoint abuse
 * protection). A fixed-window in-memory limiter is a real, correct
 * implementation for a single-process context (tests, a long-running
 * Node process such as `apps/bot`), but it is NOT sufficient in
 * production for a stateless/multi-instance deployment (e.g. Supabase
 * Edge Functions, which do not share memory across invocations or
 * regions) — see docs/architecture/TELEGRAM_AUTHENTICATION.md for the
 * documented production requirement (a shared/distributed store). This
 * interface is the boundary that implementation must satisfy; no
 * distributed rate limiter is built in Section 02.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

export interface FixedWindowRateLimiterOptions {
  readonly maxRequests: number;
  readonly windowSeconds: number;
  readonly now?: () => Date;
}

/** Real, tested, single-process fixed-window limiter. See the module doc comment for its production limits. */
export class InMemoryFixedWindowRateLimiter implements RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => Date;
  private readonly windowStartByKey = new Map<string, number>();
  private readonly countByKey = new Map<string, number>();

  constructor(options: FixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowSeconds * 1000;
    this.now = options.now ?? (() => new Date());
  }

  check(key: string): RateLimitDecision {
    const nowMs = this.now().getTime();
    const windowStart = this.windowStartByKey.get(key);

    if (windowStart === undefined || nowMs - windowStart >= this.windowMs) {
      this.windowStartByKey.set(key, nowMs);
      this.countByKey.set(key, 1);
      return { allowed: true };
    }

    const count = this.countByKey.get(key) ?? 0;
    if (count >= this.maxRequests) {
      const retryAfterSeconds = Math.ceil((windowStart + this.windowMs - nowMs) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    this.countByKey.set(key, count + 1);
    return { allowed: true };
  }
}
