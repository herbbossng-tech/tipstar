import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  // Tipstar's env vars are NOT VITE_-prefixed (they're shared with the
  // server config schema in @tipstar/config — see docs/environment-variables.md),
  // so Vite's automatic client exposure doesn't apply. Instead, load every
  // var from the repo-root .env and pass only an explicit safe subset
  // through `define`. This mirrors @tipstar/config's loadClientConfig()
  // allowlist deliberately, not by importing it: Vite loads this file with
  // Node's own module resolution (not the workspace TS project), which
  // can't follow a workspace package's TS-only "main" entry — the same
  // reason supabase/functions/* re-implement packages/telegram's algorithm
  // instead of importing it. Keep this in sync with
  // packages/config/src/load.ts's loadClientConfig() if that changes.
  const env = loadEnv(mode, REPO_ROOT, "");

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.API_BASE_URL) {
    throw new Error("Client configuration is invalid or incomplete. Set SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL in .env.");
  }
  const appEnv = env.APP_ENV === "staging" || env.APP_ENV === "production" ? env.APP_ENV : "development";
  const clientConfig = {
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    apiBaseUrl: env.API_BASE_URL,
    telegramMiniAppUrl: env.TELEGRAM_MINIAPP_URL,
    appEnv,
    devAuthBypassEnabled: appEnv !== "production" && env.TIPSTAR_DEV_AUTH_BYPASS === "true",
  };

  return {
    plugins: [react()],
    envDir: REPO_ROOT,
    server: {
      port: 5173,
    },
    define: {
      __TIPSTAR_CLIENT_CONFIG__: JSON.stringify(clientConfig),
    },
  };
});
