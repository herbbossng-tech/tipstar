import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@sport-os/shared";
import { loadClientConfig, loadServerConfig } from "./load.js";

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
    });
    expect(config.app.env).toBe("production");
    expect(config.telegram.botToken).toBe("bot-token");
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

describe("loadClientConfig", () => {
  it("loads only the VITE_-prefixed client-safe subset", () => {
    const config = loadClientConfig({ VITE_APP_NAME: "Sport OS", VITE_API_BASE_URL: "https://api.example.com", APP_ENV: "staging" });
    expect(config).toEqual({ appName: "Sport OS", apiBaseUrl: "https://api.example.com", appEnv: "staging" });
  });

  it("throws when required client vars are missing", () => {
    expect(() => loadClientConfig({})).toThrow(ConfigurationError);
  });

  it("defaults appEnv to development for an unrecognized/missing value", () => {
    const config = loadClientConfig({ VITE_APP_NAME: "Sport OS", VITE_API_BASE_URL: "https://api.example.com" });
    expect(config.appEnv).toBe("development");
  });
});
