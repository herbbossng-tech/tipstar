import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/miniapp/src/config.ts expects vite.config.ts's `define` to have
  // injected __TIPSTAR_CLIENT_CONFIG__ (see that file's comment) — tests
  // run under this root config instead, so provide the same shape with
  // inert values. Keep in sync with apps/miniapp/vite.config.ts's fields.
  define: {
    __TIPSTAR_CLIENT_CONFIG__: JSON.stringify({
      supabaseUrl: "http://localhost:54321",
      supabaseAnonKey: "test-anon-key",
      apiBaseUrl: "http://localhost:8787",
      telegramMiniAppUrl: undefined,
      appEnv: "development",
      devAuthBypassEnabled: false,
    }),
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
