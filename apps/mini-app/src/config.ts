import { loadClientConfig } from "@sport-os/config";

/**
 * Single point of access to client-safe configuration. Never read
 * `import.meta.env.*` directly elsewhere — go through this module so the
 * client/server config boundary (see @sport-os/config) stays enforced in
 * exactly one place.
 */
export const clientConfig = loadClientConfig(import.meta.env as unknown as Record<string, string | undefined>);
