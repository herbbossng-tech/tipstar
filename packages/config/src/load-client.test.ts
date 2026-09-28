import { describe, expect, it } from "vitest";
import { ConfigurationError } from "@sport-os/shared";
import { loadClientConfig } from "./load-client.js";

describe("loadClientConfig", () => {
  it("loads only the VITE_-prefixed client-safe subset", () => {
    const config = loadClientConfig({ VITE_APP_NAME: "Sport OS", VITE_API_BASE_URL: "https://api.example.com", APP_ENV: "staging" });
    expect(config).toEqual({ appName: "Sport OS", apiBaseUrl: "https://api.example.com", appEnv: "staging", devAuthModeEnabled: false });
  });

  it("throws when required client vars are missing", () => {
    expect(() => loadClientConfig({})).toThrow(ConfigurationError);
  });

  it("defaults appEnv to development for an unrecognized/missing value", () => {
    const config = loadClientConfig({ VITE_APP_NAME: "Sport OS", VITE_API_BASE_URL: "https://api.example.com" });
    expect(config.appEnv).toBe("development");
  });

  it("enables devAuthModeEnabled only outside production with the flag explicitly set", () => {
    const base = { VITE_APP_NAME: "Sport OS", VITE_API_BASE_URL: "https://api.example.com" };
    expect(loadClientConfig({ ...base, APP_ENV: "development", VITE_DEV_AUTH_MODE: "enabled" }).devAuthModeEnabled).toBe(true);
    expect(loadClientConfig({ ...base, APP_ENV: "development" }).devAuthModeEnabled).toBe(false);
    expect(loadClientConfig({ ...base, APP_ENV: "production", VITE_DEV_AUTH_MODE: "enabled" }).devAuthModeEnabled).toBe(false);
  });
});
