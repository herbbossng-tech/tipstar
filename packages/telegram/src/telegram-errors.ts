import { TelegramApiErrorCategory } from "./types.js";

/**
 * Telegram Bot API error categorization (Section 10 §27). Pure,
 * deterministic — the same (httpStatus, errorCode, description) always
 * categorizes the same way, so retry behavior is predictable and
 * testable without a real network call.
 *
 * Telegram's own documented error shape: a non-2xx HTTP response with
 * `{ ok: false, error_code: number, description: string }`. `error_code`
 * mirrors HTTP status semantics (400/401/403/404/429/5xx) but is not
 * always present on a transport-level failure (DNS/timeout), which this
 * function treats as TRANSIENT — a network blip is the textbook
 * retryable case.
 */
export interface TelegramApiErrorInfo {
  readonly httpStatus: number | undefined;
  readonly errorCode: number | undefined;
  readonly description: string | undefined;
}

export function categorizeTelegramApiError(info: TelegramApiErrorInfo): TelegramApiErrorCategory {
  const status = info.errorCode ?? info.httpStatus;

  if (status === undefined) {
    // A resolved HTTP response that carries neither Telegram's own
    // error_code nor an HTTP status is too ambiguous to safely retry —
    // UNKNOWN, not TRANSIENT. A genuine network-level failure (the call
    // never reached Telegram at all — DNS, timeout, connection reset)
    // is categorized directly by the caller's own catch block instead,
    // never through this function.
    return TelegramApiErrorCategory.UNKNOWN;
  }
  if (status === 429) {
    return TelegramApiErrorCategory.RATE_LIMITED;
  }
  if (status === 401) {
    return TelegramApiErrorCategory.AUTHORIZATION;
  }
  if (status === 403) {
    // Telegram's own convention for "bot was kicked/blocked/lacks admin
    // rights in this chat" — distinct from 401 (bad token entirely).
    return TelegramApiErrorCategory.BOT_PERMISSION;
  }
  if (status === 404) {
    return TelegramApiErrorCategory.NOT_FOUND;
  }
  if (status === 400) {
    return TelegramApiErrorCategory.INVALID_PAYLOAD;
  }
  if (status >= 500 && status < 600) {
    return TelegramApiErrorCategory.TRANSIENT;
  }
  return TelegramApiErrorCategory.UNKNOWN;
}

/** Only a TRANSIENT or RATE_LIMITED failure is ever retried automatically (§27/§28) — every other category is a terminal outcome for that attempt. */
export function isRetryableTelegramError(category: TelegramApiErrorCategory): boolean {
  return category === TelegramApiErrorCategory.TRANSIENT || category === TelegramApiErrorCategory.RATE_LIMITED;
}

/** Telegram's own `retry_after` field (seconds) on a 429 response, when present — honored exactly rather than guessed at (§28 — "respect Telegram rate limits"). */
export function extractRetryAfterSeconds(parameters: { readonly retry_after?: number } | undefined): number | undefined {
  return parameters?.retry_after;
}
