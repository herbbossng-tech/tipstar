// Supabase Edge Function (Deno runtime).
//
// POST /owner-bootstrap -> promotes the caller to OWNER, exactly once
// (Section 03 — Owner Bootstrap). There is no automatic "first Telegram
// user becomes OWNER" anywhere in this codebase, and no hard-coded
// Telegram id — reaching OWNER requires BOTH:
//   1. A valid, unexpired, non-revoked session token (the caller must
//      have already authenticated via /telegram-auth, so a `users` row
//      exists for them), AND
//   2. The exact OWNER_BOOTSTRAP_SECRET, a server-only config value that
//      exists outside the browser (see docs/environment-variables.md) —
//      compared with a timing-safe comparison and never logged, echoed,
//      or stored.
//
// platform_settings.owner_bootstrapped_at being non-null permanently
// disables this endpoint from that point on — see
// supabase/migrations/20260928120700_platform_settings.sql.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex, timingSafeStringsEqual } from "../_shared/crypto.ts";
import { verifyAuthSession } from "../_shared/session.ts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

interface AuthSessionRow {
  user_id: string;
  token_hash: string;
  revoked_at: string | null;
  expires_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST is supported.", 405);
  }

  const sessionSigningSecret = Deno.env.get("SESSION_SIGNING_SECRET");
  const ownerBootstrapSecret = Deno.env.get("OWNER_BOOTSTRAP_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sessionSigningSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse("AUTH_NOT_CONFIGURED", "This endpoint is not configured.", 500);
  }
  if (!ownerBootstrapSecret) {
    // Never distinguish "not configured" from "wrong secret" in the
    // response — both are OWNER_BOOTSTRAP_NOT_CONFIGURED here, since a
    // caller with no secret shouldn't learn whether one exists.
    return errorResponse("OWNER_BOOTSTRAP_NOT_CONFIGURED", "Owner bootstrap is not available.", 403);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) {
    return errorResponse("SESSION_MISSING", "No session token was provided.", 401);
  }

  let body: { secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
  const providedSecret = typeof body.secret === "string" ? body.secret : "";
  if (!providedSecret || !timingSafeStringsEqual(providedSecret, ownerBootstrapSecret)) {
    return errorResponse("OWNER_BOOTSTRAP_NOT_CONFIGURED", "Owner bootstrap is not available.", 403);
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const verified = await verifyAuthSession(token, sessionSigningSecret);
  if (!verified.ok) {
    return errorResponse(verified.code, verified.message, verified.code === "SESSION_EXPIRED" ? 401 : 400);
  }
  const tokenHash = await sha256Hex(token);
  const { data: sessionRow } = await supabase.from("auth_sessions").select("user_id, token_hash, revoked_at, expires_at").eq("session_id", verified.session.sessionId).maybeSingle();
  const session = sessionRow as AuthSessionRow | null;
  if (!session || session.token_hash !== tokenHash || session.revoked_at !== null || new Date(session.expires_at).getTime() <= Date.now()) {
    return errorResponse("SESSION_REVOKED", "Session has been revoked.", 401);
  }

  const { data: settingsRow } = await supabase.from("platform_settings").select("owner_bootstrapped_at").eq("id", true).maybeSingle();
  if ((settingsRow as { owner_bootstrapped_at: string | null } | null)?.owner_bootstrapped_at) {
    return errorResponse("OWNER_BOOTSTRAP_ALREADY_DONE", "Owner bootstrap has already run.", 409);
  }

  const { data: updatedUser, error: updateError } = await supabase.from("users").update({ role: "owner" }).eq("id", session.user_id).select("id, telegram_user_id, role").single();
  if (updateError || !updatedUser) {
    return errorResponse("OWNER_BOOTSTRAP_FAILED", "Could not complete owner bootstrap.", 500);
  }

  await supabase.from("platform_settings").update({ owner_bootstrapped_at: new Date().toISOString(), owner_bootstrapped_user_id: session.user_id }).eq("id", true);
  await supabase.from("audit_logs").insert({
    actor_user_id: session.user_id,
    action: "owner_bootstrapped",
    resource_type: "user",
    resource_id: session.user_id,
    outcome: "success",
    metadata: {},
  });

  return jsonResponse({ identity: { role: "owner" } }, 200);
});
