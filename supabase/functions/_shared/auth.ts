// Shared session/license/entitlement resolution for Supabase Edge
// Functions (Deno runtime) — Section 09. Factors out the exact pattern
// `me/index.ts` (Section 03) already established (verify session -> look
// up user -> look up license -> look up entitlements) so every new
// Section 09 read endpoint enforces identity + license + entitlement the
// same way, rather than re-deriving it five times. Never a new
// authorization RULE — purely a shared implementation of the one already
// proven correct by `me`.
//
// "UI gating is NOT authorization... every protected backend request
// must still enforce license + entitlement + role + policy." Every
// function in this module runs server-side only, using a service-role
// client that bypasses RLS — the ONLY thing narrowing what a caller sees
// is this module's own logic, never a client-supplied claim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "./crypto.ts";
import { verifyAuthSession } from "./session.ts";

export const CORS_HEADERS_BASE = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
};

export function corsHeaders(methods: string): Record<string, string> {
  return { ...CORS_HEADERS_BASE, "access-control-allow-methods": methods };
}

export function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extraHeaders } });
}

export function errorResponse(code: string, message: string, status: number, extraHeaders: Record<string, string>): Response {
  return jsonResponse({ error: { code, message } }, status, extraHeaders);
}

export interface AuthenticatedUserRow {
  readonly id: string;
  readonly telegram_user_id: number;
  readonly role: "owner" | "admin" | "user";
  readonly status: "active" | "suspended" | "disabled";
}

interface AuthSessionRow {
  user_id: string;
  token_hash: string;
  revoked_at: string | null;
  expires_at: string;
}

export type ResolveUserResult = { readonly ok: true; readonly user: AuthenticatedUserRow } | { readonly ok: false; readonly code: string; readonly message: string; readonly status: number };

/** Verifies the bearer token (signature + expiry + revocation) and resolves it to the caller's own user row — never any other user's. Mirrors `me/index.ts`'s `resolveAuthenticatedUser` exactly. */
export async function resolveAuthenticatedUser(client: SupabaseClient, token: string, secret: string): Promise<ResolveUserResult> {
  const verified = await verifyAuthSession(token, secret);
  if (!verified.ok) {
    return { ok: false, code: verified.code, message: verified.message, status: verified.code === "SESSION_EXPIRED" ? 401 : 400 };
  }

  const tokenHash = await sha256Hex(token);
  const { data: sessionRow, error: sessionError } = await client.from("auth_sessions").select("user_id, token_hash, revoked_at, expires_at").eq("session_id", verified.session.sessionId).maybeSingle();
  if (sessionError || !sessionRow) {
    return { ok: false, code: "SESSION_REVOKED", message: "Session has been revoked.", status: 401 };
  }
  const session = sessionRow as AuthSessionRow;
  if (session.token_hash !== tokenHash || session.revoked_at !== null || new Date(session.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: "SESSION_REVOKED", message: "Session has been revoked.", status: 401 };
  }

  const { data: userRow, error: userError } = await client.from("users").select("id, telegram_user_id, role, status").eq("id", session.user_id).maybeSingle();
  if (userError || !userRow) {
    return { ok: false, code: "USER_NOT_FOUND", message: "Your account could not be found.", status: 404 };
  }
  const user = userRow as AuthenticatedUserRow;
  if (user.status !== "active") {
    return { ok: false, code: "ACCOUNT_SUSPENDED", message: "Your account is not active.", status: 403 };
  }

  return { ok: true, user };
}

interface LicenseRow {
  id: string;
  status: "trial" | "active" | "suspended" | "expired" | "revoked";
  starts_at: string;
  expires_at: string | null;
}

function isLicenseUsable(license: LicenseRow, now: Date): boolean {
  if (license.status !== "trial" && license.status !== "active") return false;
  if (new Date(license.starts_at).getTime() > now.getTime()) return false;
  if (license.expires_at !== null && new Date(license.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

export type RequireEntitlementResult = { readonly ok: true; readonly licenseId: string } | { readonly ok: false; readonly code: string; readonly message: string; readonly status: number };

/**
 * Resolves the caller's usable license and checks it carries `featureKey`
 * enabled. `owner`/`admin` roles are never granted an implicit bypass
 * here — an operator account still needs its own license + entitlement
 * row, exactly like Section 07/08's admin-only RLS never treated `role`
 * as a substitute for entitlement. A missing entitlement row is treated
 * identically to `enabled = false` (§ DATABASE_AND_RLS.md's documented
 * convention), never silently permissive.
 */
export async function requireEntitlement(client: SupabaseClient, userId: string, featureKey: string): Promise<RequireEntitlementResult> {
  const { data: licenseData } = await client.from("licenses").select("id, status, starts_at, expires_at").eq("user_id", userId).in("status", ["active", "trial"]).maybeSingle();
  const license = licenseData as LicenseRow | null;
  if (!license || !isLicenseUsable(license, new Date())) {
    return { ok: false, code: "LICENSE_UNAVAILABLE", message: "You don't have an active license.", status: 402 };
  }

  const { data: entitlementRow } = await client.from("license_entitlements").select("enabled").eq("license_id", license.id).eq("feature_key", featureKey).maybeSingle();
  const enabled = (entitlementRow as { enabled: boolean } | null)?.enabled === true;
  if (!enabled) {
    return { ok: false, code: "FEATURE_NOT_ENTITLED", message: "This feature is not included in your plan.", status: 403 };
  }

  return { ok: true, licenseId: license.id };
}

export interface RequiredServerConfig {
  readonly sessionSigningSecret: string;
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
}

export function readServerConfig(env: { get(key: string): string | undefined }): RequiredServerConfig | undefined {
  const sessionSigningSecret = env.get("SESSION_SIGNING_SECRET");
  const supabaseUrl = env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sessionSigningSecret || !supabaseUrl || !supabaseServiceRoleKey) return undefined;
  return { sessionSigningSecret, supabaseUrl, supabaseServiceRoleKey };
}

export function bearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

/**
 * Section 11 — admin/owner role check for the new `admin-*` edge
 * functions. Mirrors `@sport-os/platform`'s own `isAdmin()`
 * (`role === "owner" || role === "admin"`) exactly — a second,
 * independent implementation only because Deno edge functions cannot
 * import the npm workspace package (the same established constraint
 * every other `_shared/` helper here already works under). "Frontend
 * gating is cosmetic... every backend endpoint independently verifies"
 * — this is that independent, server-side verification, never trusting
 * a client-supplied role claim.
 */
export function requireAdminRole(user: AuthenticatedUserRow): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string; readonly status: number } {
  if (user.role === "owner" || user.role === "admin") return { ok: true };
  return { ok: false, code: "AUTHORIZATION_ADMIN_REQUIRED", message: "This action requires administrative authority.", status: 403 };
}
