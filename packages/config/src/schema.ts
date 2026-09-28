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

    SUPABASE_URL: nonEmpty,
    SUPABASE_ANON_KEY: nonEmpty,
    SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,

    TELEGRAM_BOT_TOKEN: optionalNonEmpty,
    TELEGRAM_WEBHOOK_SECRET: optionalNonEmpty,

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
      ];
      for (const [key, name] of required) {
        if (!env[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `${name} is required when APP_ENV=production.` });
        }
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
] as const;
