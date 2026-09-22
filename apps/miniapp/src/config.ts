import type { ClientConfig } from "@tipstar/config";

// Injected at build time by vite.config.ts via `define`, from
// loadClientConfig() — the single allowlisted subset of `.env` that is
// safe to ship in the browser bundle. Never read `import.meta.env.*`
// directly for Tipstar config; always go through this module.
declare const __TIPSTAR_CLIENT_CONFIG__: ClientConfig;

export const clientConfig: ClientConfig = __TIPSTAR_CLIENT_CONFIG__;

/** Base URL for Tipstar's Supabase Edge Function endpoints (see docs/api/README.md). */
export const edgeFunctionsBaseUrl = `${clientConfig.supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
