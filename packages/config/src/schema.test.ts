import { describe, expect, it } from "vitest";
import { envSchema, SERVER_ONLY_ENV_KEYS } from "./schema.js";

const BASE_ENV = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key" };

describe("envSchema", () => {
  it("rejects an unrecognized SPORTYBET_INTEGRATION_MODE rather than silently accepting it", () => {
    const result = envSchema.safeParse({ ...BASE_ENV, SPORTYBET_INTEGRATION_MODE: "full_auto" });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized APP_ENV", () => {
    const result = envSchema.safeParse({ ...BASE_ENV, APP_ENV: "prod" });
    expect(result.success).toBe(false);
  });

  it("SERVER_ONLY_ENV_KEYS never overlaps the client-safe VITE_/Supabase-public keys", () => {
    const clientSafeKeys = ["VITE_APP_NAME", "VITE_API_BASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_ENV"];
    for (const key of SERVER_ONLY_ENV_KEYS) {
      expect(clientSafeKeys).not.toContain(key);
    }
  });
});
