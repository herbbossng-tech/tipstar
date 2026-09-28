import { ConfigurationError } from "@sport-os/shared";
import { envSchema } from "./schema.js";
import type { AppConfig, ClientConfig } from "./types.js";

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
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET },
    providers: {
      football: { name: env.FOOTBALL_DATA_PROVIDER, apiKey: env.FOOTBALL_DATA_API_KEY },
      odds: { name: env.ODDS_PROVIDER, apiKey: env.ODDS_API_KEY },
      aviator: { name: env.AVIATOR_DATA_PROVIDER, apiKey: env.AVIATOR_DATA_API_KEY },
    },
    integrations: { sportyBetMode: env.SPORTYBET_INTEGRATION_MODE },
    jobs: { enabled: env.JOBS_ENABLED },
  };
}

/**
 * Loads only the subset of configuration safe for a browser bundle (the
 * Mini App). Reads VITE_-prefixed vars only — server-only secrets are
 * never read here, and this function has no access to them by design.
 */
export function loadClientConfig(source: Record<string, string | undefined>): ClientConfig {
  const appName = source.VITE_APP_NAME;
  const apiBaseUrl = source.VITE_API_BASE_URL;
  if (!appName || !apiBaseUrl) {
    throw new ConfigurationError({ message: "Client configuration is invalid or incomplete." });
  }
  const rawEnv = source.APP_ENV;
  const appEnv = rawEnv === "staging" || rawEnv === "production" ? rawEnv : "development";
  return { appName, apiBaseUrl, appEnv };
}
