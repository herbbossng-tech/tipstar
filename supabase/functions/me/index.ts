// Supabase Edge Function (Deno runtime).
//
// GET /me -> the caller's own safe identity, role, account status,
// current license, and enabled entitlements (Section 03 — Frontend:
// minimal authenticated user area). Requires a valid session token from
// /telegram-auth in the `Authorization: Bearer <token>` header.
//
// Security invariants:
//   - The token is verified the same way /telegram-auth issues it
//     (HMAC signature + expiry — see ../_shared/session.ts) AND checked
//     against auth_sessions for revocation (Section 03 hybrid session
//     model — see docs/architecture/TELEGRAM_AUTHENTICATION.md).
//   - Never returns another user's data — the session's own user_id is
//     the only row this function will ever look up.
//   - Never returns a raw license_key, a session token/hash, or any
//     other credential-shaped value.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/crypto.ts";
import { verifyAuthSession } from "../_shared/session.ts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

interface UserRow {
  id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  language_code: string | null;
  is_premium: boolean;
  role: "owner" | "admin" | "user";
  status: "active" | "suspended" | "disabled";
}

interface AuthSessionRow {
  user_id: string;
  token_hash: string;
  revoked_at: string | null;
  expires_at: string;
}

interface LicenseRow {
  id: string;
  plan: string;
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

async function resolveAuthenticatedUser(client: SupabaseClient, token: string, secret: string): Promise<{ ok: true; user: UserRow } | { ok: false; code: string; message: string; status: number }> {
  const verified = await verifyAuthSession(token, secret);
  if (!verified.ok) {
    return { ok: false, code: verified.code, message: verified.message, status: verified.code === "SESSION_EXPIRED" ? 401 : 400 };
  }

  const tokenHash = await sha256Hex(token);
  const { data: sessionRow, error: sessionError } = await client
    .from("auth_sessions")
    .select("user_id, token_hash, revoked_at, expires_at")
    .eq("session_id", verified.session.sessionId)
    .maybeSingle();

  if (sessionError || !sessionRow) {
    return { ok: false, code: "SESSION_REVOKED", message: "Session has been revoked.", status: 401 };
  }
  const session = sessionRow as AuthSessionRow;
  if (session.token_hash !== tokenHash || session.revoked_at !== null || new Date(session.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: "SESSION_REVOKED", message: "Session has been revoked.", status: 401 };
  }

  const { data: userRow, error: userError } = await client
    .from("users")
    .select("id, telegram_user_id, username, first_name, last_name, language_code, is_premium, role, status")
    .eq("id", session.user_id)
    .maybeSingle();
  if (userError || !userRow) {
    return { ok: false, code: "USER_NOT_FOUND", message: "Your account could not be found.", status: 404 };
  }

  return { ok: true, user: userRow as UserRow };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported.", 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) {
    return errorResponse("SESSION_MISSING", "No session token was provided.", 401);
  }

  const sessionSigningSecret = Deno.env.get("SESSION_SIGNING_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sessionSigningSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse("AUTH_NOT_CONFIGURED", "This endpoint is not configured.", 500);
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const resolved = await resolveAuthenticatedUser(supabase, token, sessionSigningSecret);
  if (!resolved.ok) {
    return errorResponse(resolved.code, resolved.message, resolved.status);
  }
  const { user } = resolved;

  const { data: licenseData } = await supabase
    .from("licenses")
    .select("id, plan, status, starts_at, expires_at")
    .eq("user_id", user.id)
    .in("status", ["active", "trial"])
    .maybeSingle();
  const license = licenseData as LicenseRow | null;

  let entitlements: string[] = [];
  if (license) {
    const { data: entitlementRows } = await supabase.from("license_entitlements").select("feature_key").eq("license_id", license.id).eq("enabled", true);
    entitlements = ((entitlementRows ?? []) as { feature_key: string }[]).map((row) => row.feature_key);
  }

  return jsonResponse(
    {
      identity: {
        telegramUserId: user.telegram_user_id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        languageCode: user.language_code,
        isPremium: user.is_premium,
        role: user.role,
        status: user.status,
      },
      // No raw license_key here or anywhere else this function touches —
      // only the safe fields a Mini App screen legitimately needs.
      license: license
        ? { plan: license.plan, status: license.status, startsAt: license.starts_at, expiresAt: license.expires_at, isActive: isLicenseUsable(license, new Date()) }
        : null,
      entitlements,
    },
    200,
  );
});
