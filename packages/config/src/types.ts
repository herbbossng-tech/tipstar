import type { Environment } from "@sport-os/shared";

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
  };
  readonly providers: {
    readonly football: { readonly name: string | undefined; readonly apiKey: string | undefined };
    readonly odds: { readonly name: string | undefined; readonly apiKey: string | undefined };
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
}
