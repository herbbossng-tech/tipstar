import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // .env lives at the repo root (npm workspaces monorepo), not per-app.
  // Only VITE_-prefixed vars are exposed to client code — Vite's own
  // built-in allowlist (see .env.example) — nothing extra to configure.
  envDir: REPO_ROOT,
  server: {
    port: 5173,
  },
});
