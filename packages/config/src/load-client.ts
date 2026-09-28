import { ConfigurationError } from "@sport-os/shared";
import type { ClientConfig } from "./types.js";

/**
 * Loads only the subset of configuration safe for a browser bundle (the
 * Mini App). Reads VITE_-prefixed vars only — server-only secrets are
 * never read here, and this function has no access to them by design.
 *
 * Deliberately kept in its own module, separate from load.ts/schema.ts:
 * those import zod's `envSchema`, whose builder-chain calls
 * (`z.object(...).superRefine(...)`) bundlers can't prove side-effect-free
 * and therefore won't tree-shake, even when only `loadClientConfig` is
 * imported. That previously leaked the full server env var schema
 * (variable names, not values — see `SERVER_ONLY_ENV_KEYS`) into the Mini
 * App's browser bundle. Import from `@sport-os/config/client`, not the
 * package root, to keep this module's graph free of `schema.ts` entirely.
 */
export function loadClientConfig(source: Record<string, string | undefined>): ClientConfig {
  const appName = source.VITE_APP_NAME;
  const apiBaseUrl = source.VITE_API_BASE_URL;
  if (!appName || !apiBaseUrl) {
    throw new ConfigurationError({ message: "Client configuration is invalid or incomplete." });
  }
  const rawEnv = source.APP_ENV;
  const appEnv = rawEnv === "staging" || rawEnv === "production" ? rawEnv : "development";
  const devAuthModeEnabled = appEnv !== "production" && source.VITE_DEV_AUTH_MODE === "enabled";
  return { appName, apiBaseUrl, appEnv, devAuthModeEnabled };
}
