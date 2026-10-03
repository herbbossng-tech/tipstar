import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only touches jsdom/@testing-library state (Section 09) — a safe
    // no-op for every other test in the monorepo, which never renders
    // anything for it to clean up. See apps/mini-app/src/test-setup.ts.
    setupFiles: ["apps/mini-app/src/test-setup.ts"],
    include: ["packages/**/*.test.ts", "apps/**/src/**/*.test.ts", "apps/**/src/**/*.test.tsx", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
