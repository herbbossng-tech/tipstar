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
/** Parses a comma-separated env value into a trimmed, non-empty string array — never fabricates an entry, never silently keeps a blank one. */
function parseCommaSeparatedIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

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
      publishRetryLimit: env.TELEGRAM_PUBLISH_RETRY_LIMIT,
      publishTimeoutMs: env.TELEGRAM_PUBLISH_TIMEOUT_MS,
      miniAppUrl: env.TELEGRAM_MINI_APP_URL,
    },
    session: { signingSecret: env.SESSION_SIGNING_SECRET, tokenTtlSeconds: env.SESSION_TOKEN_TTL_SECONDS },
    ownerBootstrap: { secret: env.OWNER_BOOTSTRAP_SECRET },
    devAuth: { mode: env.DEV_AUTH_MODE },
    providers: {
      football: {
        name: env.FOOTBALL_DATA_PROVIDER,
        apiKey: env.FOOTBALL_DATA_API_KEY,
        enabled: env.FOOTBALL_DATA_ENABLED === "true",
        baseUrl: env.FOOTBALL_DATA_BASE_URL,
        timeoutMs: env.FOOTBALL_DATA_TIMEOUT_MS,
        maxRetries: env.FOOTBALL_DATA_MAX_RETRIES,
        rateLimitPerMinute: env.FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE,
        pollIntervalSeconds: env.FOOTBALL_DATA_POLL_INTERVAL_SECONDS,
        selectedIds: parseCommaSeparatedIds(env.FOOTBALL_DATA_COMPETITION_IDS),
      },
      odds: {
        name: env.ODDS_PROVIDER,
        apiKey: env.ODDS_API_KEY,
        enabled: env.ODDS_ENABLED === "true",
        baseUrl: env.ODDS_BASE_URL,
        timeoutMs: env.ODDS_TIMEOUT_MS,
        maxRetries: env.ODDS_MAX_RETRIES,
        rateLimitPerMinute: env.ODDS_RATE_LIMIT_PER_MINUTE,
        pollIntervalSeconds: env.ODDS_POLL_INTERVAL_SECONDS,
        selectedIds: parseCommaSeparatedIds(env.ODDS_SPORT_KEYS),
      },
      aviator: { name: env.AVIATOR_DATA_PROVIDER, apiKey: env.AVIATOR_DATA_API_KEY },
    },
    integrations: { sportyBetMode: env.SPORTYBET_INTEGRATION_MODE },
    jobs: { enabled: env.JOBS_ENABLED },
  };
}
