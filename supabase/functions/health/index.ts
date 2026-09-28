// Supabase Edge Function (Deno runtime).
//
// GET /health -> HealthReport (Section 01 — Health/Observability
// Foundation). Mirrors @sport-os/platform's HealthReport shape and
// buildHealthReport() logic — Deno cannot import that npm workspace
// package directly without a bundling step, so the shape is
// re-implemented here; keep both in sync if the contract changes.
//
// This function performs no I/O and never returns a secret — it is
// deliberately lightweight.

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

type ServiceReadiness = "ready" | "not_ready" | "unknown";
type ApplicationStatus = "ok" | "degraded" | "down";

function deriveStatus(services: Record<string, ServiceReadiness>): ApplicationStatus {
  const values = Object.values(services);
  if (values.includes("not_ready")) return "down";
  if (values.includes("unknown")) return "degraded";
  return "ok";
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: CORS_HEADERS });
  }

  const environment = Deno.env.get("APP_ENV") ?? "development";
  const version = Deno.env.get("APP_VERSION") ?? "0.1.0";
  // No dependency checks are implemented yet (no database schema exists —
  // see supabase/migrations/README.md) — report the app itself as ready
  // and leave dependency readiness "unknown" rather than fabricating "ready".
  const services: Record<string, ServiceReadiness> = { app: "ready" };

  const report = {
    status: deriveStatus(services),
    environment,
    version,
    timestamp: new Date().toISOString(),
    services,
  };

  return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json", ...CORS_HEADERS } });
});
