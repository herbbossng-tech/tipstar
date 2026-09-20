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

/**
 * Loads only the subset of configuration safe for a browser bundle
 * (the Mini App). Server-only secrets are never read here.
 */
export function loadClientConfig(source: Record<string, string | undefined>): {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiBaseUrl: string;
  readonly telegramMiniAppUrl: string | undefined;
} {
  const supabaseUrl = source.SUPABASE_URL;
  const supabaseAnonKey = source.SUPABASE_ANON_KEY;
  const apiBaseUrl = source.API_BASE_URL;
  if (!supabaseUrl || !supabaseAnonKey || !apiBaseUrl) {
    throw new TipstarError({
      code: ErrorCodes.CONFIG_INVALID,
      message: "Client configuration is invalid or incomplete.",
    });
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl,
    telegramMiniAppUrl: source.TELEGRAM_MINIAPP_URL,
  };
}
