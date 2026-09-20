import { init, isTMA, retrieveRawInitData } from "@telegram-apps/sdk";

export interface TelegramBootstrapResult {
  readonly isRunningInTelegram: boolean;
  /**
   * The raw, still-signed initData string. This is sent to the backend as-is
   * for HMAC validation (@tipstar/telegram) — the client NEVER parses it to
   * derive a trusted user identity itself (Engineering Constitution M).
   */
  readonly rawInitData: string | undefined;
}

/**
 * Initializes the Telegram Mini Apps SDK bridge when running inside
 * Telegram, and retrieves the raw initData payload to hand to the backend.
 * Outside Telegram (e.g. a browser during local development) this safely
 * reports isRunningInTelegram: false instead of throwing.
 */
export function bootstrapTelegram(): TelegramBootstrapResult {
  if (!isTMA()) {
    return { isRunningInTelegram: false, rawInitData: undefined };
  }

  init();

  let rawInitData: string | undefined;
  try {
    rawInitData = retrieveRawInitData();
  } catch {
    rawInitData = undefined;
  }

  return { isRunningInTelegram: true, rawInitData };
}
