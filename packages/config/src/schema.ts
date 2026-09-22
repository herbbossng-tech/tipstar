import { z } from "zod";

const nonEmpty = z.string().min(1);

/**
 * Full environment schema. Grouped by concern (see .env.example). Anything
 * under `supabase.serviceRoleKey` or a provider secret must never be read
 * from client-side code — enforce that by only importing loadServerConfig()
 * from server/edge-function entry points, never from apps/miniapp.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  SUPABASE_URL: nonEmpty,
  SUPABASE_ANON_KEY: nonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Legacy (HS256) Supabase project JWT secret. Used to SIGN the Tipstar
  // application session token so PostgREST accepts it as an authenticated
  // request and exposes its claims to RLS via tipstar_auth_user_id().
  // SERVER-ONLY — see SERVER_ONLY_ENV_KEYS below.
  TIPSTAR_JWT_SECRET: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_MINIAPP_URL: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
  // development | staging | production — kept distinct from APP_ENV so a
  // Telegram bot/Mini App environment can be swapped independently of the
  // general app environment if the two ever diverge (Section 11).
  TELEGRAM_ENVIRONMENT: z.enum(["development", "staging", "production"]).optional(),

  // Session tokens issued after a validated Telegram login (Section 02).
  SESSION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(21600),
  // Development-only Telegram auth bypass (Section 10). Must never be true
  // in production — enforced again at the point of use, not just here.
  TIPSTAR_DEV_AUTH_BYPASS: z
    .string()
    .optional()
    .transform((value) => value === "true"),

  API_BASE_URL: nonEmpty,

  SPORTS_PROVIDER: z.string().default("mock"),
  SPORTS_PROVIDER_API_KEY: z.string().optional(),
  SPORTS_PROVIDER_BASE_URL: z.string().optional(),

  ODDS_PROVIDER: z.string().default("mock"),
  ODDS_PROVIDER_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.string().default("anthropic"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),

  PAYMENT_PROVIDER: z.string().default("mock"),
  PAYMENT_PROVIDER_API_KEY: z.string().optional(),
  PAYMENT_PROVIDER_WEBHOOK_SECRET: z.string().optional(),

  AFFILIATE_PROVIDER: z.string().default("mock"),
  AFFILIATE_PROVIDER_API_KEY: z.string().optional(),

  NOTIFICATION_PROVIDER: z.string().default("telegram"),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface TipstarConfig {
  readonly app: {
    readonly nodeEnv: "development" | "test" | "production";
    readonly appEnv: "development" | "staging" | "production";
    readonly logLevel: "debug" | "info" | "warn" | "error";
    readonly apiBaseUrl: string;
  };
  readonly supabase: {
    readonly url: string;
    readonly anonKey: string;
    /** Present only when loaded via loadServerConfig(). Never expose to the client bundle. */
    readonly serviceRoleKey: string | undefined;
    /** SERVER-ONLY. Signs/verifies Tipstar session tokens. Never expose to the client bundle. */
    readonly jwtSecret: string | undefined;
  };
  readonly telegram: {
    readonly botToken: string | undefined;
    readonly botUsername: string | undefined;
    readonly webhookSecret: string | undefined;
    readonly miniAppUrl: string | undefined;
    readonly channelId: string | undefined;
    readonly initDataMaxAgeSeconds: number;
    readonly environment: "development" | "staging" | "production" | undefined;
  };
  readonly session: {
    readonly tokenTtlSeconds: number;
    /** True only outside production AND when explicitly opted in — see docs/architecture/telegram-security.md. */
    readonly devAuthBypassEnabled: boolean;
  };
  readonly providers: {
    readonly sports: { readonly name: string; readonly apiKey: string | undefined; readonly baseUrl: string | undefined };
    readonly odds: { readonly name: string; readonly apiKey: string | undefined };
    readonly llm: { readonly name: string; readonly apiKey: string | undefined; readonly model: string | undefined };
    readonly payment: { readonly name: string; readonly apiKey: string | undefined; readonly webhookSecret: string | undefined };
    readonly affiliate: { readonly name: string; readonly apiKey: string | undefined };
    readonly notification: { readonly name: string };
  };
}

export function toConfig(env: RawEnv): TipstarConfig {
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      appEnv: env.APP_ENV,
      logLevel: env.LOG_LEVEL,
      apiBaseUrl: env.API_BASE_URL,
    },
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.TIPSTAR_JWT_SECRET,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      miniAppUrl: env.TELEGRAM_MINIAPP_URL,
      channelId: env.TELEGRAM_CHANNEL_ID,
      initDataMaxAgeSeconds: env.TELEGRAM_INITDATA_MAX_AGE_SECONDS,
      environment: env.TELEGRAM_ENVIRONMENT,
    },
    session: {
      tokenTtlSeconds: env.SESSION_TOKEN_TTL_SECONDS,
      devAuthBypassEnabled: env.APP_ENV !== "production" && env.TIPSTAR_DEV_AUTH_BYPASS === true,
    },
    providers: {
      sports: { name: env.SPORTS_PROVIDER, apiKey: env.SPORTS_PROVIDER_API_KEY, baseUrl: env.SPORTS_PROVIDER_BASE_URL },
      odds: { name: env.ODDS_PROVIDER, apiKey: env.ODDS_PROVIDER_API_KEY },
      llm: { name: env.LLM_PROVIDER, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL },
      payment: { name: env.PAYMENT_PROVIDER, apiKey: env.PAYMENT_PROVIDER_API_KEY, webhookSecret: env.PAYMENT_PROVIDER_WEBHOOK_SECRET },
      affiliate: { name: env.AFFILIATE_PROVIDER, apiKey: env.AFFILIATE_PROVIDER_API_KEY },
      notification: { name: env.NOTIFICATION_PROVIDER },
    },
  };
}

/** Config fields that must never be exposed to a browser bundle (Mini App client). */
export const SERVER_ONLY_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TIPSTAR_JWT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "SPORTS_PROVIDER_API_KEY",
  "ODDS_PROVIDER_API_KEY",
  "LLM_API_KEY",
  "PAYMENT_PROVIDER_API_KEY",
  "PAYMENT_PROVIDER_WEBHOOK_SECRET",
  "AFFILIATE_PROVIDER_API_KEY",
] as const;
