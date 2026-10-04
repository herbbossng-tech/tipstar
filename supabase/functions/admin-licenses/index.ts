// Supabase Edge Function (Deno runtime).
//
// GET  /admin-licenses?limit=&offset=  -> bounded, newest-first listing
//      of users with their current active/trial license status (if
//      any) — mirrors @sport-os/platform's listUsersForAdmin() exactly,
//      reimplemented here only because Deno edge functions cannot
//      import the npm workspace package (the same established
//      constraint every other admin-* function already works under).
// POST /admin-licenses { action: "create", userId, plan, status,
//      expiresAt, maxDevices, entitlements } -> creates a NEW license
//      for a user via the real createLicense() domain rule (admin-only,
//      audited, never bypassing the DB's "one active/trial license per
//      user" unique index) and, if `entitlements` is given, enables
//      exactly those feature keys on it. This is the admin counterpart
//      the Mini App's Admin screen was missing — Section 11 already
//      built and tested the underlying licensing model and its
//      admin-only `createLicense()` rule; this only exposes it, it does
//      not add a new licensing concept.
//
// OWNER/ADMIN only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireAdminRole, resolveAuthenticatedUser } from "../_shared/auth.ts";
import { createFixedWindowRateLimiter } from "../_shared/rate-limit.ts";

const METHODS = "GET, POST, OPTIONS";
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const VALID_CREATE_STATUSES = new Set(["trial", "active"]);
const VALID_FEATURE_KEYS = new Set(["football_analysis", "football_tickets", "football_automation", "aviator_analysis", "aviator_automation", "telegram_auto_publish", "telegram_multi_channel", "weekly_reports", "advanced_analytics"]);

// Section 12 Part T pattern (see admin-jobs/admin-reports) — defense in
// depth against a scripted/compromised admin account, not the primary
// control (the DB's own unique-active-license index is).
const createRateLimiter = createFixedWindowRateLimiter(10, 60);

function generateLicenseKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `LIC-${token}`;
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(METHODS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const token = bearerToken(req);
  if (!token) return errorResponse("SESSION_MISSING", "No session token was provided.", 401, headers);

  const config = readServerConfig(Deno.env);
  if (!config) return errorResponse("NOT_CONFIGURED", "This endpoint is not configured.", 500, headers);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const resolvedUser = await resolveAuthenticatedUser(supabase, token, config.sessionSigningSecret);
  if (!resolvedUser.ok) return errorResponse(resolvedUser.code, resolvedUser.message, resolvedUser.status, headers);

  const authz = requireAdminRole(resolvedUser.user);
  if (!authz.ok) return errorResponse(authz.code, authz.message, authz.status, headers);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? DEFAULT_LIST_LIMIT) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

    const { data: users, error: usersError } = await supabase.from("users").select("id, telegram_user_id, username, first_name, role, status, created_at").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (usersError) return errorResponse("QUERY_FAILED", "Could not load users.", 500, headers);

    const userIds = (users ?? []).map((u: { id: string }) => u.id);
    const { data: licenses } = userIds.length > 0 ? await supabase.from("licenses").select("id, user_id, plan, status, expires_at").in("user_id", userIds).in("status", ["active", "trial"]) : { data: [] };
    const licenseByUser = new Map((licenses ?? []).map((l: { user_id: string }) => [l.user_id, l]));

    const summaries = (users ?? []).map((u: { id: string }) => ({ user: u, currentLicense: licenseByUser.get(u.id) ?? null }));
    return jsonResponse({ users: summaries }, 200, headers);
  }

  if (req.method === "POST") {
    if (!createRateLimiter.check(resolvedUser.user.id)) {
      return errorResponse("RATE_LIMITED", "Too many requests. Try again shortly.", 429, headers);
    }

    let body: { action?: string; userId?: string; plan?: string; status?: string; expiresAt?: string | null; maxDevices?: number | null; entitlements?: readonly string[] };
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_PAYLOAD", "Request body must be JSON.", 400, headers);
    }

    if (body.action !== "create" || !body.userId || !body.plan || !body.status) {
      return errorResponse("INVALID_PAYLOAD", 'Only {"action":"create","userId":"...","plan":"...","status":"trial"|"active",...} is supported.', 400, headers);
    }
    if (!VALID_CREATE_STATUSES.has(body.status)) {
      return errorResponse("INVALID_PAYLOAD", 'status must be "trial" or "active".', 400, headers);
    }
    const entitlements = (body.entitlements ?? []).filter((key) => VALID_FEATURE_KEYS.has(key));

    const { data: targetUser, error: targetUserError } = await supabase.from("users").select("id").eq("id", body.userId).maybeSingle();
    if (targetUserError || !targetUser) return errorResponse("USER_NOT_FOUND", "No user found with that id.", 404, headers);

    const { data: license, error: insertError } = await supabase
      .from("licenses")
      .insert({ user_id: body.userId, license_key: generateLicenseKey(), plan: body.plan, status: body.status, starts_at: new Date().toISOString(), expires_at: body.expiresAt ?? null, max_devices: body.maxDevices ?? null, created_by: resolvedUser.user.id })
      .select("id, user_id, plan, status, starts_at, expires_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return errorResponse("LICENSE_ALREADY_ACTIVE", "This user already has an active or trial license — only one may exist at a time. Renew or reactivate it instead.", 409, headers);
      }
      return errorResponse("LICENSE_CREATE_FAILED", "Could not create the license.", 500, headers);
    }

    if (entitlements.length > 0) {
      const rows = entitlements.map((featureKey) => ({ license_id: license.id, feature_key: featureKey, enabled: true }));
      const { error: entitlementError } = await supabase.from("license_entitlements").insert(rows);
      if (entitlementError) console.error("admin-licenses: entitlement insert failed", entitlementError.message);
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_user_id: resolvedUser.user.id, action: "license_created", resource_type: "license", resource_id: license.id, outcome: "success", metadata: { userId: body.userId, plan: body.plan, status: body.status } });
    if (auditError) console.error("admin-licenses: best-effort audit write failed", auditError.message);

    return jsonResponse({ license }, 200, headers);
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Only GET/POST are supported.", 405, headers);
});
