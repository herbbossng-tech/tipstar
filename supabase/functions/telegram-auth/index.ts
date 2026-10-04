// Supabase Edge Function (Deno runtime).
//
// POST /telegram-auth -> a verified Telegram identity + a signed session
// token (Section 02 — Telegram Authentication; Section 03 — Database +
// RLS + Roles + Licensing adds the user upsert, session persistence, and
// audit logging below). Mirrors the validation, authentication-service,
// and session algorithms in @sport-os/telegram — Deno cannot import that
// npm workspace package directly without a bundling step, so the
// algorithms are re-implemented in ../_shared/ instead of node:crypto;
// keep both in sync if either changes. See
// docs/architecture/TELEGRAM_AUTHENTICATION.md and
// docs/architecture/DATABASE_AND_RLS.md for the full rationale.
//
// Security invariants (do not weaken without updating the docs above):
//   - Telegram identity is NEVER trusted from client-supplied fields —
//     only from a server-side HMAC-validated `initData` string.
//   - TELEGRAM_BOT_TOKEN / SESSION_SIGNING_SECRET / SUPABASE_SERVICE_ROLE_KEY
//     are read from Deno.env only, never logged, never echoed in any
//     response.
//   - Dev-mode auth is only reachable when DEV_AUTH_MODE=enabled AND
//     APP_ENV!=production, re-checked here independently of any client
//     input, and always returns a FIXED synthetic identity — a client
//     can never request an arbitrary Telegram user id.
//   - The service-role Supabase client bypasses RLS entirely — every use
//     of it below is for the one specific, narrow operation this
//     function is already authorized to perform (upserting the caller's
//     OWN row by their just-verified telegram_user_id, and persisting
//     the session/audit rows this same request produced). It is never
//     used to satisfy an arbitrary client-supplied query.
//   - A new user's role/status are never read from the client — the
//     database's own DEFAULT 'user'/'active' is what applies; this
//     function's upsert payload has no role/status field at all.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fromHex, hmacSha256, sha256Hex, textEncoder, timingSafeEqualBytes } from "../_shared/crypto.ts";
import { createFixedWindowRateLimiter } from "../_shared/rate-limit.ts";
import { issueAuthSession, type AuthSession } from "../_shared/session.ts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const WEB_APP_DATA_KEY = "WebAppData";

const TelegramAuthErrorCode = {
  INIT_DATA_MISSING: "TELEGRAM_INIT_DATA_MISSING",
  INIT_DATA_INVALID: "TELEGRAM_INIT_DATA_INVALID",
  INIT_DATA_EXPIRED: "TELEGRAM_INIT_DATA_EXPIRED",
  INIT_DATA_MALFORMED: "TELEGRAM_INIT_DATA_MALFORMED",
  AUTH_NOT_CONFIGURED: "TELEGRAM_AUTH_NOT_CONFIGURED",
  USER_MISSING: "TELEGRAM_USER_MISSING",
  DEV_AUTH_NOT_USABLE: "TELEGRAM_DEV_AUTH_NOT_USABLE",
  RATE_LIMITED: "TELEGRAM_AUTH_RATE_LIMITED",
} as const;

interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface AuthenticatedIdentity {
  telegramUserId: number;
  firstName: string;
  lastName: string | undefined;
  username: string | undefined;
  languageCode: string | undefined;
  isPremium: boolean | undefined;
  authDate: string;
  verifiedAt: string;
  authMode: "telegram" | "dev";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

interface ValidatedInitData {
  readonly user: TelegramWebAppUser | undefined;
  readonly authDate: Date;
}

interface ValidationFailure {
  readonly code: string;
  readonly message: string;
}

type ValidationResult = { ok: true; value: ValidatedInitData } | { ok: false; error: ValidationFailure };

/**
 * Validates a Telegram Mini App `initData` string server-side. See
 * packages/telegram/src/init-data.ts for the canonical Node
 * implementation and full algorithm documentation — this is the same
 * algorithm, reimplemented for Deno's Web Crypto API.
 */
async function validateInitData(initDataRaw: string, botToken: string, maxAgeSeconds: number, clockSkewSeconds: number): Promise<ValidationResult> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_MALFORMED, message: "Telegram initData could not be parsed." } };
  }

  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_INVALID, message: "Telegram initData signature is invalid." } };
  }

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = await hmacSha256(textEncoder.encode(WEB_APP_DATA_KEY), botToken);
  const computedHashBytes = await hmacSha256(secretKey, dataCheckString);

  const hashesMatch = timingSafeEqualBytes(computedHashBytes, fromHex(hash.toLowerCase()));
  if (!hashesMatch) {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_INVALID, message: "Telegram initData signature is invalid." } };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_MALFORMED, message: "Telegram initData is missing auth_date." } };
  }
  const authDateSeconds = Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds) || authDateSeconds <= 0) {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_MALFORMED, message: "Telegram initData has a malformed auth_date." } };
  }
  const authDate = new Date(authDateSeconds * 1000);
  const now = new Date();
  const ageSeconds = (now.getTime() - authDate.getTime()) / 1000;
  if (ageSeconds > maxAgeSeconds || ageSeconds < -clockSkewSeconds) {
    return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_EXPIRED, message: "Telegram initData has expired." } };
  }

  let user: TelegramWebAppUser | undefined;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TelegramWebAppUser;
    } catch {
      return { ok: false, error: { code: TelegramAuthErrorCode.INIT_DATA_MALFORMED, message: "Telegram initData user field could not be parsed." } };
    }
  }

  return { ok: true, value: { user, authDate } };
}

interface AppUserRecord {
  id: string;
  role: "owner" | "admin" | "user";
  status: "active" | "suspended" | "disabled";
}

/**
 * The one place this function may create or update a `users` row —
 * mirrors @sport-os/platform's upsertAuthenticatedTelegramUser() exactly
 * (same guarantee: the payload has no role/status/id field, so a
 * conflicting update can never touch them). See
 * docs/architecture/DATABASE_AND_RLS.md's "Authentication → database
 * identity".
 */
async function upsertAuthenticatedTelegramUser(client: SupabaseClient, identity: AuthenticatedIdentity): Promise<{ user: AppUserRecord; isNewUser: boolean }> {
  const { data: existing } = await client.from("users").select("id").eq("telegram_user_id", identity.telegramUserId).maybeSingle();
  const isNewUser = !existing;

  const { data, error } = await client
    .from("users")
    .upsert(
      {
        telegram_user_id: identity.telegramUserId,
        username: identity.username ?? null,
        first_name: identity.firstName,
        last_name: identity.lastName ?? null,
        language_code: identity.languageCode ?? null,
        is_premium: identity.isPremium ?? false,
        last_authenticated_at: identity.verifiedAt,
      },
      { onConflict: "telegram_user_id" },
    )
    .select("id, role, status")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert authenticated user: ${error?.message ?? "unknown error"}`);
  }
  return { user: data as AppUserRecord, isNewUser };
}

async function persistAuthSession(client: SupabaseClient, userId: string, session: AuthSession, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  const { error } = await client.from("auth_sessions").insert({
    user_id: userId,
    session_id: session.sessionId,
    token_hash: tokenHash,
    issued_at: session.issuedAt,
    expires_at: session.expiresAt,
  });
  if (error) {
    throw new Error(`Failed to persist session: ${error.message}`);
  }
}

async function recordAuditEvent(
  client: SupabaseClient,
  actorUserId: string | null,
  action: string,
  outcome: "success" | "failure" | "denied",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  // Best-effort: an audit-write failure must never block the
  // authentication response it describes — logged to the function's own
  // console (never containing secrets/raw initData) rather than thrown.
  const { error } = await client.from("audit_logs").insert({
    actor_user_id: actorUserId,
    action,
    resource_type: "user",
    resource_id: actorUserId,
    outcome,
    metadata,
  });
  if (error) {
    console.error("Failed to record audit event", action, error.message);
  }
}

function isDevAuthModeUsable(appEnv: string, devAuthMode: string): boolean {
  return appEnv !== "production" && devAuthMode === "enabled";
}

/** Always the same fixed values — never parameterized by anything the caller supplies. */
function buildDevAuthenticatedIdentity(): AuthenticatedIdentity {
  const now = new Date().toISOString();
  return {
    telegramUserId: 999_999_999,
    firstName: "Dev",
    lastName: "User",
    username: "dev_user_do_not_use_in_production",
    languageCode: "en",
    isPremium: false,
    authDate: now,
    verifiedAt: now,
    authMode: "dev",
  };
}

// Fixed-window in-memory rate limiting (Section 12 — extracted into
// `_shared/rate-limit.ts` so admin mutation endpoints reuse the exact
// same logic). Scoped to a single warm isolate — defense in depth, not
// the primary control; see that module's own doc comment.
const rateLimiter = createFixedWindowRateLimiter(20, 60);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST is supported.", 405);
  }

  const clientKey = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimiter.check(clientKey)) {
    return errorResponse(TelegramAuthErrorCode.RATE_LIMITED, "Too many authentication attempts. Try again shortly.", 429);
  }

  let body: { initData?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse(TelegramAuthErrorCode.INIT_DATA_MALFORMED, "Request body must be valid JSON.", 400);
  }

  const appEnv = Deno.env.get("APP_ENV") ?? "development";
  const devAuthMode = Deno.env.get("DEV_AUTH_MODE") ?? "disabled";
  const sessionSigningSecret = Deno.env.get("SESSION_SIGNING_SECRET");
  const sessionTokenTtlSeconds = Number(Deno.env.get("SESSION_TOKEN_TTL_SECONDS") ?? "86400");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!sessionSigningSecret) {
    // Never log/return *why* in more detail than this — no secret state to leak here anyway.
    return errorResponse(TelegramAuthErrorCode.AUTH_NOT_CONFIGURED, "Session signing is not configured.", 500);
  }
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return errorResponse(TelegramAuthErrorCode.AUTH_NOT_CONFIGURED, "Database access is not configured.", 500);
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let identity: AuthenticatedIdentity;

  if (body.mode === "dev") {
    if (!isDevAuthModeUsable(appEnv, devAuthMode)) {
      return errorResponse(TelegramAuthErrorCode.DEV_AUTH_NOT_USABLE, "Dev-mode authentication is not available.", 403);
    }
    identity = buildDevAuthenticatedIdentity();
  } else {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return errorResponse(TelegramAuthErrorCode.AUTH_NOT_CONFIGURED, "Telegram authentication is not configured.", 500);
    }

    const rawInitData = typeof body.initData === "string" ? body.initData : "";
    if (!rawInitData.trim()) {
      return errorResponse(TelegramAuthErrorCode.INIT_DATA_MISSING, "Telegram initData was not provided.", 400);
    }

    const maxAgeSeconds = Number(Deno.env.get("TELEGRAM_INIT_DATA_MAX_AGE_SECONDS") ?? "86400");
    const clockSkewSeconds = Number(Deno.env.get("TELEGRAM_INIT_DATA_CLOCK_SKEW_SECONDS") ?? "60");

    const validated = await validateInitData(rawInitData, botToken, maxAgeSeconds, clockSkewSeconds);
    if (!validated.ok) {
      // No user id is known yet at this point — actor_user_id is
      // nullable precisely for this case. Never includes rawInitData or
      // the bot token in metadata.
      await recordAuditEvent(supabase, null, "telegram_authentication_failed", "failure", { code: validated.error.code });
      const status = validated.error.code === TelegramAuthErrorCode.INIT_DATA_EXPIRED ? 401 : 400;
      return errorResponse(validated.error.code, validated.error.message, status);
    }
    if (!validated.value.user) {
      return errorResponse(TelegramAuthErrorCode.USER_MISSING, "Telegram initData did not include a user.", 400);
    }

    const user = validated.value.user;
    identity = {
      telegramUserId: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      languageCode: user.language_code,
      isPremium: user.is_premium,
      authDate: validated.value.authDate.toISOString(),
      verifiedAt: new Date().toISOString(),
      authMode: "telegram",
    };
  }

  let user: AppUserRecord;
  let isNewUser: boolean;
  try {
    ({ user, isNewUser } = await upsertAuthenticatedTelegramUser(supabase, identity));
  } catch (error) {
    console.error("Failed to upsert authenticated user", error);
    return errorResponse("USER_UPSERT_FAILED", "Could not complete sign-in. Please try again.", 500);
  }

  const issued = await issueAuthSession(identity, sessionSigningSecret, sessionTokenTtlSeconds);

  try {
    await persistAuthSession(supabase, user.id, issued.session, issued.token);
  } catch (error) {
    console.error("Failed to persist session", error);
    return errorResponse("SESSION_PERSIST_FAILED", "Could not complete sign-in. Please try again.", 500);
  }

  await recordAuditEvent(supabase, user.id, isNewUser ? "telegram_user_created" : "telegram_user_authenticated", "success", { authMode: identity.authMode });

  return jsonResponse(
    {
      identity: {
        telegramUserId: identity.telegramUserId,
        firstName: identity.firstName,
        lastName: identity.lastName,
        username: identity.username,
        languageCode: identity.languageCode,
        isPremium: identity.isPremium,
        authMode: identity.authMode,
        role: user.role,
        status: user.status,
      },
      session: { token: issued.token, expiresAt: issued.session.expiresAt },
    },
    200,
  );
});
