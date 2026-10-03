import type { Environment } from "@sport-os/shared";

/**
 * Section 04 — Provider Configuration. Mirrors
 * packages/football-engine/src/provider.ts's ProviderConfig shape at the
 * env-var layer. `apiKey` is present only when loaded via
 * loadServerConfig() and must never reach a browser bundle.
 */
export interface FootballDataProviderEnvConfig {
  readonly name: string | undefined;
  readonly apiKey: string | undefined;
  readonly enabled: boolean;
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly rateLimitPerMinute: number | undefined;
  readonly pollIntervalSeconds: number | undefined;
}

export interface AppConfig {
  readonly app: {
    readonly env: Environment;
    readonly name: string;
    readonly version: string;
    readonly logLevel: "debug" | "info" | "warn" | "error";
  };
  readonly supabase: {
    readonly url: string;
    readonly anonKey: string;
    /** Present only when loaded via loadServerConfig(). Never expose to the client bundle. */
    readonly serviceRoleKey: string | undefined;
  };
  readonly telegram: {
    readonly botToken: string | undefined;
    readonly webhookSecret: string | undefined;
    readonly initDataMaxAgeSeconds: number;
    readonly initDataClockSkewSeconds: number;
    /** Section 10 — bounded retry count for TRANSIENT/RATE_LIMITED Telegram Bot API failures. */
    readonly publishRetryLimit: number;
    /** Section 10 — per-attempt Telegram Bot API call timeout. */
    readonly publishTimeoutMs: number;
    /** Section 10 — the Mini App's own public URL, for "Open Mini App" buttons only. `undefined` means every caller omits the button rather than fabricating a link. */
    readonly miniAppUrl: string | undefined;
  };
  readonly session: {
    /** Present only when loaded via loadServerConfig(). Never expose to the client bundle. */
    readonly signingSecret: string | undefined;
    readonly tokenTtlSeconds: number;
  };
  readonly ownerBootstrap: {
    /** Present only when loaded via loadServerConfig(). Undefined = bootstrap permanently unavailable. Never expose to the client bundle. */
    readonly secret: string | undefined;
  };
  readonly devAuth: {
    readonly mode: "enabled" | "disabled";
  };
  readonly providers: {
    readonly football: FootballDataProviderEnvConfig;
    readonly odds: FootballDataProviderEnvConfig;
    readonly aviator: { readonly name: string | undefined; readonly apiKey: string | undefined };
  };
  readonly integrations: {
    readonly sportyBetMode: "manual" | "assisted" | "disabled";
  };
  readonly jobs: {
    readonly enabled: boolean;
  };
}

export interface ClientConfig {
  readonly appName: string;
  readonly apiBaseUrl: string;
  readonly appEnv: Environment;
  /** Whether the Mini App should show a dev-login affordance. Never a capability grant on its own — the server independently re-enforces this. */
  readonly devAuthModeEnabled: boolean;
}
