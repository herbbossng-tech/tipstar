/// <reference path="./telegram-webapp.d.ts" />

/**
 * Thin, typed wrapper around the Telegram WebApp bridge
 * (`window.Telegram.WebApp`), injected by Telegram's own inline script
 * when the Mini App is opened inside Telegram. Hand-rolled rather than an
 * added SDK dependency, per Section 01's "no unnecessary dependencies"
 * principle — see telegram-webapp.d.ts for the ambient type declarations.
 *
 * This is deliberately a thin bridge, not an identity source: the only
 * thing it hands the rest of the app is the raw, opaque `initData` string,
 * which must be verified server-side before anything in it is trusted
 * (see docs/architecture/TELEGRAM_AUTHENTICATION.md). `initDataUnsafe` is
 * never exposed here.
 */
export interface TelegramWebAppClient {
  readonly isAvailable: boolean;
  getRawInitData(): string;
  ready(): void;
  expand(): void;
}

class BrowserTelegramWebAppClient implements TelegramWebAppClient {
  private readonly webApp: TelegramWebApp | undefined;

  constructor() {
    this.webApp = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  }

  get isAvailable(): boolean {
    return this.webApp !== undefined && typeof this.webApp.initData === "string" && this.webApp.initData.length > 0;
  }

  getRawInitData(): string {
    return this.webApp?.initData ?? "";
  }

  ready(): void {
    this.webApp?.ready();
  }

  expand(): void {
    this.webApp?.expand();
  }
}

export function createTelegramWebAppClient(): TelegramWebAppClient {
  return new BrowserTelegramWebAppClient();
}
