// Supabase Edge Function (Deno runtime).
//
// GET /telegram-me
// Authorization: Bearer <Tipstar session token>
//   -> { "user": UserProfileDTO }
//
// Demonstrates and exercises the full session/RLS contract end-to-end: the
// bearer token is verified here (signature + expiry), then handed to a
// Supabase client authenticated as that token — NOT the service role — so
// PostgREST evaluates the same Row Level Security policies a direct client
// query would (see supabase/migrations/20260919000000_init_schema.sql,
// `users_select_own` etc.). This endpoint can only ever return the caller's
// own profile: if RLS wouldn't allow the read, this returns nothing.
//
// Deploy: supabase functions deploy telegram-me
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, TIPSTAR_JWT_SECRET

const encoder = new TextEncoder();
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
};

// @ts-expect-error -- resolved by the Supabase Edge Functions (Deno) runtime, not the workspace TS project.
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function hmacSha256(keyMaterial: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyBytes = typeof keyMaterial === "string" ? encoder.encode(keyMaterial) : keyMaterial;
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(signature);
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SessionClaims {
  sub: string;
  role: "authenticated";
  tipstar_user_id: string;
  telegram_user_id: number;
  iat: number;
  exp: number;
}

/** Mirrors packages/session/src/jwt.ts's verifySessionToken — keep in sync. */
async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | undefined> {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts;

  const expectedSignature = base64url(await hmacSha256(secret, `${header}.${payload}`));
  if (!timingSafeEqual(expectedSignature, signature)) return undefined;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(fromBase64url(payload)) as SessionClaims;
  } catch {
    return undefined;
  }
  if (claims.role !== "authenticated" || typeof claims.tipstar_user_id !== "string") return undefined;
  if (Math.floor(Date.now() / 1000) > claims.exp + 60) return undefined;
  return claims;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const jwtSecret = Deno.env.get("TIPSTAR_JWT_SECRET");
  if (!supabaseUrl || !anonKey || !jwtSecret) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : undefined;
  if (!token) {
    return json({ error: "unauthorized", reason: "missing_session" }, 401);
  }

  const claims = await verifySessionToken(token, jwtSecret);
  if (!claims) {
    return json({ error: "unauthorized", reason: "session_invalid_or_expired" }, 401);
  }

  // Authenticated AS THE CALLER, not the service role — RLS decides what
  // comes back. This is the same trust boundary a direct client query
  // would go through; this function does not bypass it.
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const [{ data: userRow, error: userError }, { data: identityRow }, { data: roleRows }, { data: notificationPrefs }] = await Promise.all([
    supabase.from("users").select("id, status, language_code, created_at, last_active_at").eq("id", claims.tipstar_user_id).maybeSingle(),
    supabase
      .from("telegram_identities")
      .select("telegram_username, first_name, last_name, is_premium")
      .eq("user_id", claims.tipstar_user_id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", claims.tipstar_user_id),
    supabase
      .from("notification_preferences")
      .select("pick_alerts, result_alerts, subscription_alerts, marketing_messages")
      .eq("user_id", claims.tipstar_user_id)
      .maybeSingle(),
  ]);

  if (userError || !userRow) {
    return json({ error: "unauthorized", reason: "session_not_found" }, 401);
  }

  return json(
    {
      user: {
        id: userRow.id,
        status: userRow.status,
        roles: (roleRows ?? []).map((r: { role: string }) => r.role),
        languageCode: userRow.language_code,
        createdAt: userRow.created_at,
        lastActiveAt: userRow.last_active_at,
        telegram: {
          username: identityRow?.telegram_username ?? null,
          firstName: identityRow?.first_name ?? null,
          lastName: identityRow?.last_name ?? null,
          isPremium: identityRow?.is_premium ?? null,
        },
        notificationPreferences: notificationPrefs ?? null,
      },
    },
    200,
  );
});
