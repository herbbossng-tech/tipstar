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

  // Atomic, database-enforced one-time claim + OWNER promotion — a single
  // RPC call into public.claim_owner_bootstrap(), never a prior SELECT
  // followed by separate UPDATEs. That SQL function performs the
  // platform_settings claim and the users.role promotion inside one
  // Postgres transaction: Postgres's row-level lock on the conditional
  // UPDATE means at most one concurrent caller can ever have `claimed ===
  // true`, and a promotion failure rolls back the whole transaction
  // (including the claim), so the two can never diverge. See
  // supabase/migrations/20260928121000_owner_bootstrap_atomic_claim.sql.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_owner_bootstrap", { p_user_id: session.user_id });
  if (claimError) {
    // The authoritative state transition itself did not commit — never
    // report success here, whatever the underlying cause.
    return errorResponse("OWNER_BOOTSTRAP_FAILED", "Could not complete owner bootstrap.", 500);
  }
  if (claimed !== true) {
    return errorResponse("OWNER_BOOTSTRAP_ALREADY_DONE", "Owner bootstrap has already run.", 409);
  }

  // Best-effort only, from here on: the one-time bootstrap state
  // transition has already been committed by the RPC above, so an audit
  // write failure must never change (or roll back) the success response.
  // supabase-js resolves with { error } on a DB-level failure (RLS,
  // constraint, etc.) rather than throwing — a bare try/catch around
  // .insert() would never actually observe that failure, so the returned
  // error is checked explicitly here instead.
  const { error: auditError } = await supabase.from("audit_logs").insert({
    actor_user_id: session.user_id,
    action: "owner_bootstrapped",
    resource_type: "user",
    resource_id: session.user_id,
    outcome: "success",
    metadata: {},
  });
  if (auditError) {
    console.error("owner-bootstrap: best-effort audit write failed", auditError.message);
  }

  return jsonResponse({ identity: { role: "owner" } }, 200);
});
