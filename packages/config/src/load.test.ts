import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@sport-os/shared";
import { loadServerConfig } from "./load.js";

const BASE_ENV = {
  APP_ENV: "development",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
};

describe("loadServerConfig", () => {
  it("loads a valid development environment with sensible defaults", () => {
    const config = loadServerConfig(BASE_ENV);
    expect(config.app.env).toBe("development");
    expect(config.app.name).toBe("Sport Intelligence OS");
    expect(config.supabase.url).toBe("https://example.supabase.co");
    expect(config.integrations.sportyBetMode).toBe("disabled");
    expect(config.jobs.enabled).toBe(false);
  });

  it("throws ConfigurationError (never echoing raw values) when required vars are missing", () => {
    expect(() => loadServerConfig({})).toThrow(ConfigurationError);
    try {
      loadServerConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).message).not.toContain("SUPABASE_URL");
      expect((error as ConfigurationError).context.invalidFields).toContain("SUPABASE_URL");
    }
  });

  it("fails safely in production when secrets are missing, rather than defaulting insecurely", () => {
    expect(() => loadServerConfig({ ...BASE_ENV, APP_ENV: "production" })).toThrow(ConfigurationError);
  });

  it("succeeds in production once every required secret is present", () => {
    const config = loadServerConfig({
      ...BASE_ENV,
      APP_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
      SESSION_SIGNING_SECRET: "session-signing-secret",
    });
    expect(config.app.env).toBe("production");
    expect(config.telegram.botToken).toBe("bot-token");
    expect(config.session.signingSecret).toBe("session-signing-secret");
  });

  it("fails safely in production when SESSION_SIGNING_SECRET is missing", () => {
    expect(() =>
      loadServerConfig({
        ...BASE_ENV,
        APP_ENV: "production",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
      }),
    ).toThrow(ConfigurationError);
  });

  it("refuses to load in production when DEV_AUTH_MODE is enabled, even alongside every other required secret", () => {
    expect(() =>
      loadServerConfig({
        ...BASE_ENV,
        APP_ENV: "production",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        TELEGRAM_BOT_TOKEN: "bot-token",
        TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
        SESSION_SIGNING_SECRET: "session-signing-secret",
        DEV_AUTH_MODE: "enabled",
      }),
    ).toThrow(ConfigurationError);
  });

  it("defaults the Telegram initData freshness window and session TTL", () => {
    const config = loadServerConfig(BASE_ENV);
    expect(config.telegram.initDataMaxAgeSeconds).toBe(86400);
    expect(config.telegram.initDataClockSkewSeconds).toBe(60);
    expect(config.session.tokenTtlSeconds).toBe(86400);
    expect(config.devAuth.mode).toBe("disabled");
  });

  it("parses the Telegram initData freshness window and session TTL from the environment", () => {
    const config = loadServerConfig({ ...BASE_ENV, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "3600", TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS: "30", SESSION_TOKEN_TTL_SECONDS: "7200" });
    expect(config.telegram.initDataMaxAgeSeconds).toBe(3600);
    expect(config.telegram.initDataClockSkewSeconds).toBe(30);
    expect(config.session.tokenTtlSeconds).toBe(7200);
  });

  it("does not require Telegram/provider secrets outside production", () => {
    const config = loadServerConfig(BASE_ENV);
    expect(config.telegram.botToken).toBeUndefined();
    expect(config.supabase.serviceRoleKey).toBeUndefined();
  });

  it("parses JOBS_ENABLED as a real boolean, not a truthy string", () => {
    expect(loadServerConfig({ ...BASE_ENV, JOBS_ENABLED: "true" }).jobs.enabled).toBe(true);
    expect(loadServerConfig({ ...BASE_ENV, JOBS_ENABLED: "false" }).jobs.enabled).toBe(false);
    expect(loadServerConfig({ ...BASE_ENV, JOBS_ENABLED: "yes" }).jobs.enabled).toBe(false);
  });
});
