/**
 * Client-safe entry point (`@sport-os/config/client`). Import this from
 * browser code (apps/mini-app) instead of the package root — the root
 * barrel re-exports schema.ts's `envSchema`, which bundlers can't
 * tree-shake away (see load-client.ts's doc comment), so importing it
 * even indirectly leaks the full server env var schema into the bundle.
 * This module's graph never touches schema.ts or zod at all.
 */
export { loadClientConfig } from "./load-client.js";
export type { ClientConfig } from "./types.js";
