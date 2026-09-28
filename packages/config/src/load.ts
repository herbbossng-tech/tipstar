import { ConfigurationError } from "@sport-os/shared";
import { envSchema } from "./schema.js";
import type { AppConfig } from "./types.js";

export { loadClientConfig } from "./load-client.js";

/**
 * Loads and validates full server-side configuration from process.env.
 * Throws ConfigurationError with a redacted, safe message on failure —
 * never echoes back raw env values that might be secrets. In production,
 * missing required secrets fail this call rather than silently falling
 * back to an insecure default (Section 01 — Environment Model).
 */
export function loadServerConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ConfigurationError({
      message: "Server configuration is invalid or incomplete.",
      context: { invalidFields },
    });
  }
  const env = parsed.data;
  return {
    app: { env: env.APP_ENV, name: env.APP_NAME, version: env.APP_VERSION, logLevel: env.LOG_LEVEL },
    supabase: { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      initDataMaxAgeSeconds: env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      initDataClockSkewSeconds: env.TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS,
    },
    session: { signingSecret: env.SESSION_SIGNING_SECRET, tokenTtlSeconds: env.SESSION_TOKEN_TTL_SECONDS },
    devAuth: { mode: env.DEV_AUTH_MODE },
    providers: {
      football: { name: env.FOOTBALL_DATA_PROVIDER, apiKey: env.FOOTBALL_DATA_API_KEY },
      odds: { name: env.ODDS_PROVIDER, apiKey: env.ODDS_API_KEY },
      aviator: { name: env.AVIATOR_DATA_PROVIDER, apiKey: env.AVIATOR_DATA_API_KEY },
    },
    integrations: { sportyBetMode: env.SPORTYBET_INTEGRATION_MODE },
    jobs: { enabled: env.JOBS_ENABLED },
  };
}
