import { loadServerConfig } from "@sport-os/config";
import { ConfigurationError } from "@sport-os/shared";

/**
 * Fails fast at process startup (Section 12 Part B — "production startup
 * fails safely when critical secrets are absent") — mirrors
 * `apps/bot/src/config.ts`'s exact pattern. `loadServerConfig()` itself
 * already refuses to load in production with any required secret
 * missing or `DEV_AUTH_MODE=enabled`; this adds the one extra
 * requirement unique to this process: without a service-role key there
 * is no way to claim/update `operational_jobs` rows at all.
 */
export function loadWorkerConfig() {
  const config = loadServerConfig();
  if (!config.supabase.serviceRoleKey) {
    throw new ConfigurationError({ message: "SUPABASE_SERVICE_ROLE_KEY is required to run the worker." });
  }
  return config;
}
