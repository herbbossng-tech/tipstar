import { z } from "zod";

const nonEmpty = z.string().min(1);
const optionalNonEmpty = z.string().min(1).optional();

/**
 * Full environment schema (Section 01 — Configuration). Grouped by concern,
 * mirrors .env.example. Server-only fields must never be read from
 * client-side code — enforce that by only calling loadServerConfig() from
 * server/edge-function entry points, never from apps/mini-app.
 */
export const envSchema = z
  .object({
    APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
    APP_NAME: nonEmpty.default("Sport Intelligence OS"),
    APP_VERSION: nonEmpty.default("0.1.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    VITE_APP_NAME: nonEmpty.default("Sport Intelligence OS"),
    VITE_API_BASE_URL: nonEmpty.default("http://localhost:8787"),
    // Client-visible mirror of DEV_AUTH_MODE (Section 02). Only VITE_-
    // prefixed vars reach the browser bundle (see vite.config.ts), so this
    // purely controls whether the Mini App SHOWS a dev-login affordance —
    // it grants no capability by itself. The server independently
    // re-enforces DEV_AUTH_MODE + non-production via isDevAuthModeUsable()
    // regardless of what this is set to.
    VITE_DEV_AUTH_MODE: z.enum(["enabled", "disabled"]).default("disabled"),

    SUPABASE_URL: nonEmpty,
    SUPABASE_ANON_KEY: nonEmpty,
    SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,

    // Section 03 — one-time OWNER bootstrap. Absent by default, which
    // makes bootstrapOwner() permanently unavailable — a safe, fail-
    // closed default rather than something that must be required.
    OWNER_BOOTSTRAP_SECRET: optionalNonEmpty,

    TELEGRAM_BOT_TOKEN: optionalNonEmpty,
    TELEGRAM_WEBHOOK_SECRET: optionalNonEmpty,
    // Telegram initData freshness window (Section 02 — replay protection).
    // Defaults mirror @sport-os/telegram's own defaults so an unset env
    // var behaves identically to calling validateInitData() with no options.
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),
    TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(60),

    // Stateless HMAC-signed session tokens (Section 02 — Session
    // Architecture; see docs/architecture/TELEGRAM_AUTHENTICATION.md).
    // Required in production, like the other auth secrets below.
    SESSION_SIGNING_SECRET: optionalNonEmpty,
    SESSION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

    // Gated dev-mode Telegram authentication bypass (Section 02). Never
    // usable in production regardless of this flag — see
    // isDevAuthModeUsable() in @sport-os/telegram, which re-derives that
    // check independently rather than trusting this flag alone.
    DEV_AUTH_MODE: z.enum(["enabled", "disabled"]).default("disabled"),

    FOOTBALL_DATA_PROVIDER: optionalNonEmpty,
    FOOTBALL_DATA_API_KEY: optionalNonEmpty,
    ODDS_PROVIDER: optionalNonEmpty,
    ODDS_API_KEY: optionalNonEmpty,
    AVIATOR_DATA_PROVIDER: optionalNonEmpty,
    AVIATOR_DATA_API_KEY: optionalNonEmpty,

    // manual | assisted | disabled — never assume an undocumented public
    // API; see docs/architecture/OPEN_QUESTIONS.md.
    SPORTYBET_INTEGRATION_MODE: z.enum(["manual", "assisted", "disabled"]).default("disabled"),

    JOBS_ENABLED: z
      .string()
      .optional()
      .transform((value) => value === "true"),
  })
  .superRefine((env, ctx) => {
    // Fail safely rather than silently falling back to insecure defaults:
    // these are required for the app to function correctly in production,
    // even though they're optional in development for easier local setup.
    if (env.APP_ENV === "production") {
      const required: Array<[keyof typeof env, string]> = [
        ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"],
        ["TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_SECRET"],
        ["SESSION_SIGNING_SECRET", "SESSION_SIGNING_SECRET"],
      ];
      for (const [key, name] of required) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `${name} is required when APP_ENV=production.` });
        }
      }
      // Defense in depth: isDevAuthModeUsable() already refuses this
      // combination at call time, but a production deploy should never
      // even be able to load with the flag set, misconfiguration or not.
      if (env.DEV_AUTH_MODE === "enabled") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DEV_AUTH_MODE"], message: "DEV_AUTH_MODE must not be 'enabled' when APP_ENV=production." });
      }
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

/** Config fields that must never be exposed to a browser bundle (Mini App client). */
export const SERVER_ONLY_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "FOOTBALL_DATA_API_KEY",
  "ODDS_API_KEY",
  "AVIATOR_DATA_API_KEY",
  "SESSION_SIGNING_SECRET",
  "OWNER_BOOTSTRAP_SECRET",
] as const;
