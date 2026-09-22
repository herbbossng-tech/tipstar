import { TipstarError, ErrorCodes } from "@tipstar/shared";
import { envSchema, toConfig, type TipstarConfig } from "./schema.js";

/**
 * Loads and validates server-side configuration from process.env.
 * Throws TipstarError(CONFIG_INVALID) with a redacted, safe message on
 * failure — never echoes back raw env values that might be secrets.
 */
export function loadServerConfig(source: Record<string, string | undefined> = process.env): TipstarConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missingOrInvalid = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new TipstarError({
      code: ErrorCodes.CONFIG_INVALID,
      message: "Server configuration is invalid or incomplete.",
      context: { fields: missingOrInvalid },
    });
  }
  return toConfig(parsed.data);
}

export interface ClientConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiBaseUrl: string;
  readonly telegramMiniAppUrl: string | undefined;
  readonly appEnv: "development" | "staging" | "production";
  /**
   * True only when the server has explicitly enabled the development
   * Telegram-auth bypass (never true in production — see
   * docs/architecture/telegram-security.md). This is not a secret; it only
   * controls whether the Mini App shows a dev-only "Continue without
   * Telegram" affordance. The backend independently re-checks this before
   * honoring a bypass request — this flag is a UX convenience only.
   */
  readonly devAuthBypassEnabled: boolean;
}

/**
 * Loads only the subset of configuration safe for a browser bundle
 * (the Mini App). Server-only secrets are never read here — this is the
 * allowlist `apps/miniapp`'s build is permitted to embed.
 */
export function loadClientConfig(source: Record<string, string | undefined>): ClientConfig {
  const supabaseUrl = source.SUPABASE_URL;
  const supabaseAnonKey = source.SUPABASE_ANON_KEY;
  const apiBaseUrl = source.API_BASE_URL;
  if (!supabaseUrl || !supabaseAnonKey || !apiBaseUrl) {
    throw new TipstarError({
      code: ErrorCodes.CONFIG_INVALID,
      message: "Client configuration is invalid or incomplete.",
    });
  }
  const appEnv = source.APP_ENV === "staging" || source.APP_ENV === "production" ? source.APP_ENV : "development";
  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl,
    telegramMiniAppUrl: source.TELEGRAM_MINIAPP_URL,
    appEnv,
    devAuthBypassEnabled: appEnv !== "production" && source.TIPSTAR_DEV_AUTH_BYPASS === "true",
  };
}
