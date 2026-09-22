import { apiRequest } from "./client.js";
import type { CurrentUserResponse, TelegramAuthResponse } from "./types.js";

/**
 * Exchanges raw, still-signed Telegram initData for a Tipstar session.
 * The client never parses initData itself — this call is the only place
 * it's sent anywhere, and only to the backend for HMAC validation.
 */
export function authenticateWithTelegram(rawInitData: string): Promise<TelegramAuthResponse> {
  return apiRequest<TelegramAuthResponse>("telegram-init-auth", {
    method: "POST",
    body: { initData: rawInitData },
  });
}

/**
 * DEVELOPMENT ONLY. Only ever called when the server has advertised
 * `devAuthBypassEnabled` (see src/config.ts) — the backend independently
 * re-verifies it is not running in production before honoring this.
 */
export function authenticateWithDevBypass(devTelegramUser: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}): Promise<TelegramAuthResponse> {
  return apiRequest<TelegramAuthResponse>("telegram-init-auth", {
    method: "POST",
    body: { devTelegramUser },
  });
}

export function fetchCurrentUser(accessToken: string): Promise<CurrentUserResponse> {
  return apiRequest<CurrentUserResponse>("telegram-me", { method: "GET", accessToken });
}
