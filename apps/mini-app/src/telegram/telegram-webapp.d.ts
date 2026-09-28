export {};

declare global {
  interface TelegramWebAppUnsafeUser {
    readonly id: number;
    readonly first_name: string;
    readonly last_name?: string;
    readonly username?: string;
    readonly language_code?: string;
    readonly is_premium?: boolean;
    readonly photo_url?: string;
  }

  interface TelegramWebAppUnsafeInitData {
    readonly user?: TelegramWebAppUnsafeUser;
    readonly auth_date?: number;
    readonly hash?: string;
    readonly query_id?: string;
    readonly start_param?: string;
  }

  interface TelegramWebApp {
    readonly initData: string;
    /**
     * Telegram's own client-side parse of `initData`. NEVER use this for
     * identity or authorization decisions — it is fully attacker-
     * controlled from a compromised or spoofed client. Only the raw
     * `initData` string, validated server-side, may ever establish
     * identity. See docs/architecture/TELEGRAM_AUTHENTICATION.md.
     */
    readonly initDataUnsafe: TelegramWebAppUnsafeInitData;
    readonly version: string;
    readonly platform: string;
    readonly colorScheme: "light" | "dark";
    ready(): void;
    expand(): void;
    close(): void;
  }

  interface Window {
    Telegram?: {
      readonly WebApp?: TelegramWebApp;
    };
  }
}
