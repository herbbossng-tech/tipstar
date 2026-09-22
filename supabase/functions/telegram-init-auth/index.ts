// Supabase Edge Function (Deno runtime).
//
// POST /telegram-init-auth
// { "initData": "<raw Telegram Mini App initData>" }
//   -> { "user": UserProfileDTO, "session": { accessToken, tokenType, expiresAt } }
//
// This is the ONLY place Telegram identity may be trusted from. It:
//   1. Cryptographically validates `initData` (mirrors
//      packages/telegram/src/init-data.ts — keep the algorithm identical;
//      Deno cannot import that Node workspace package directly without a
//      bundling step, so it is re-implemented here using Web Crypto).
//   2. Idempotently resolves/creates the internal Tipstar user via the
//      `upsert_telegram_user` RPC (supabase/migrations/20260921000000_...),
//      using the service-role key so it can bypass RLS for this one write.
//   3. Issues a Tipstar session token (mirrors packages/session/src/jwt.ts)
//      signed with SUPABASE_JWT_SECRET, so PostgREST/RLS accept it on
//      subsequent requests (see supabase/functions/telegram-me).
//
// The bot token, service-role key, and JWT secret never leave this
// function — the client only ever receives the session token.
//
// Deploy: supabase functions deploy telegram-init-auth
// Required secrets:
//   TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
// Optional secrets:
//   TELEGRAM_INITDATA_MAX_AGE_SECONDS (default 86400)
//   SESSION_TOKEN_TTL_SECONDS (default 21600)
//   APP_ENV, TIPSTAR_DEV_AUTH_BYPASS (see "Development mode" below)

// @ts-expect-error -- resolved by the Supabase Edge Functions (Deno) runtime, not the workspace TS project.
import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

type ValidationResult =
  | { valid: true; user: TelegramUser | undefined; authDate: number }
  | { valid: false; reason: string };

async function validateInitData(initDataRaw: string, botToken: string, maxAgeSeconds: number): Promise<ValidationResult> {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing_hash" };

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = await hmacSha256("WebAppData", botToken);
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!timingSafeEqualHex(computedHash, hash)) {
    return { valid: false, reason: "signature_invalid" };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return { valid: false, reason: "missing_auth_date" };
  const authDate = Number(authDateRaw);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    return { valid: false, reason: "expired" };
  }

  const userRaw = params.get("user");
  let user: TelegramUser | undefined;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      return { valid: false, reason: "malformed_user" };
    }
  }
  if (!user) return { valid: false, reason: "missing_user" };

  return { valid: true, user, authDate };
}

/** Mirrors packages/session/src/jwt.ts's issueSessionToken — keep in sync. */
async function issueSessionToken(
  claims: { sub: string; role: "authenticated"; tipstar_user_id: string; telegram_user_id: number },
  secret: string,
  ttlSeconds: number,
): Promise<{ accessToken: string; tokenType: "bearer"; expiresAt: string }> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ ...claims, iat, exp }));
  const headerAndPayload = `${header}.${payload}`;
  const signature = base64url(await hmacSha256(secret, headerAndPayload));
  return {
    accessToken: `${headerAndPayload}.${signature}`,
    tokenType: "bearer",
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function isDevBypassEnabled(): boolean {
  const appEnv = Deno.env.get("APP_ENV") ?? "development";
  return appEnv !== "production" && Deno.env.get("TIPSTAR_DEV_AUTH_BYPASS") === "true";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !jwtSecret || !botToken) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const maxAgeSeconds = Number(Deno.env.get("TELEGRAM_INITDATA_MAX_AGE_SECONDS") ?? "86400");
  const sessionTtlSeconds = Number(Deno.env.get("SESSION_TOKEN_TTL_SECONDS") ?? "21600");

  let body: { initData?: string; devTelegramUser?: TelegramUser };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  let telegramUser: TelegramUser;
  let authMode: "telegram" | "dev_bypass" = "telegram";

  if (body.devTelegramUser && isDevBypassEnabled()) {
    // DEVELOPMENT ONLY — see docs/architecture/telegram-security.md.
    // isDevBypassEnabled() re-checks APP_ENV itself; this path is
    // unreachable when APP_ENV=production regardless of client input.
    telegramUser = body.devTelegramUser;
    authMode = "dev_bypass";
  } else {
    if (!body.initData) {
      return json({ error: "missing_init_data" }, 400);
    }
    const result = await validateInitData(body.initData, botToken, maxAgeSeconds);
    if (!result.valid) {
      return json({ error: "unauthorized", reason: result.reason }, 401);
    }
    telegramUser = result.user as TelegramUser;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: upsertRows, error: upsertError } = await supabase.rpc("upsert_telegram_user", {
    p_telegram_user_id: telegramUser.id,
    p_username: telegramUser.username ?? null,
    p_first_name: telegramUser.first_name ?? null,
    p_last_name: telegramUser.last_name ?? null,
    p_language_code: telegramUser.language_code ?? null,
    p_is_premium: telegramUser.is_premium ?? null,
  });

  if (upsertError || !upsertRows || upsertRows.length === 0) {
    // Never leak the raw database error to the client (Engineering
    // Constitution: no internal stack traces / diagnostics to end users).
    console.error("upsert_telegram_user failed", upsertError);
    return json({ error: "user_provisioning_failed" }, 503);
  }

  const resolvedUser = upsertRows[0] as {
    user_id: string;
    status: string;
    language_code: string | null;
    created_at: string;
    last_active_at: string | null;
  };

  const [{ data: identityRow }, { data: roleRows }, { data: notificationPrefs }] = await Promise.all([
    supabase
      .from("telegram_identities")
      .select("telegram_username, first_name, last_name, is_premium")
      .eq("user_id", resolvedUser.user_id)
      .single(),
    supabase.from("user_roles").select("role").eq("user_id", resolvedUser.user_id),
    supabase
      .from("notification_preferences")
      .select("pick_alerts, result_alerts, subscription_alerts, marketing_messages")
      .eq("user_id", resolvedUser.user_id)
      .maybeSingle(),
  ]);

  const session = await issueSessionToken(
    { sub: resolvedUser.user_id, role: "authenticated", tipstar_user_id: resolvedUser.user_id, telegram_user_id: telegramUser.id },
    jwtSecret,
    sessionTtlSeconds,
  );

  return json(
    {
      user: {
        id: resolvedUser.user_id,
        status: resolvedUser.status,
        roles: (roleRows ?? []).map((r: { role: string }) => r.role),
        languageCode: resolvedUser.language_code,
        createdAt: resolvedUser.created_at,
        lastActiveAt: resolvedUser.last_active_at,
        telegram: {
          username: identityRow?.telegram_username ?? null,
          firstName: identityRow?.first_name ?? null,
          lastName: identityRow?.last_name ?? null,
          isPremium: identityRow?.is_premium ?? null,
        },
        notificationPreferences: notificationPrefs ?? null,
      },
      session,
      authMode,
    },
    200,
  );
});
