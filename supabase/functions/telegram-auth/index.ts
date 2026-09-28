// Supabase Edge Function (Deno runtime).
//
// POST /telegram-auth -> a verified Telegram identity + a signed session
// token (Section 02 — Telegram Authentication). Mirrors the validation,
// authentication-service, and session algorithms in @sport-os/telegram —
// Deno cannot import that npm workspace package directly without a
// bundling step, so the algorithms are re-implemented here using Web
// Crypto instead of node:crypto; keep both in sync if either changes. See
// docs/architecture/TELEGRAM_AUTHENTICATION.md for the full rationale.
//
// Security invariants (do not weaken without updating the doc above):
//   - Telegram identity is NEVER trusted from client-supplied fields —
//     only from a server-side HMAC-validated `initData` string.
//   - TELEGRAM_BOT_TOKEN / SESSION_SIGNING_SECRET are read from
//     Deno.env only, never logged, never echoed in any response.
//   - Dev-mode auth is only reachable when DEV_AUTH_MODE=enabled AND
//     APP_ENV!=production, re-checked here independently of any client
//     input, and always returns a FIXED synthetic identity — a client
//     can never request an arbitrary Telegram user id.

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

const textEncoder = new TextEncoder();

async function hmacSha256(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return new Uint8Array(signature);
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Constant-time byte comparison — an ordinary `===` would leak timing
// information about how many leading bytes matched.
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlFromString(value: string): string {
  return base64urlFromBytes(textEncoder.encode(value));
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

interface AuthSession {
  readonly sessionId: string;
  readonly telegramUserId: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authenticatedAt: string;
}

/** Stateless HMAC-signed session token — see packages/telegram/src/session.ts for the canonical implementation and rationale. */
async function issueAuthSession(identity: AuthenticatedIdentity, secret: string, ttlSeconds: number): Promise<{ session: AuthSession; token: string }> {
  const now = new Date();
  const session: AuthSession = {
    sessionId: crypto.randomUUID(),
    telegramUserId: identity.telegramUserId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    authenticatedAt: identity.verifiedAt,
  };
  const payload = base64urlFromString(JSON.stringify(session));
  const signatureBytes = await hmacSha256(textEncoder.encode(secret), payload);
  return { session, token: `${payload}.${base64urlFromBytes(signatureBytes)}` };
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

// Fixed-window in-memory rate limiting, scoped to a single warm isolate.
// This is NOT sufficient on its own for a distributed edge deployment
// (concurrent/cold isolates don't share this Map) — see
// packages/shared/src/rate-limit.ts for the same caveat on the Node side.
// It is defense in depth, not the primary control.
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const rateLimitState = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string): boolean {
  const nowSeconds = Date.now() / 1000;
  const entry = rateLimitState.get(key);
  if (!entry || nowSeconds - entry.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
    rateLimitState.set(key, { count: 1, windowStart: nowSeconds });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  entry.count += 1;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST is supported.", 405);
  }

  const clientKey = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(clientKey)) {
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

  if (!sessionSigningSecret) {
    // Never log/return *why* in more detail than this — no secret state to leak here anyway.
    return errorResponse(TelegramAuthErrorCode.AUTH_NOT_CONFIGURED, "Session signing is not configured.", 500);
  }

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

  const issued = await issueAuthSession(identity, sessionSigningSecret, sessionTokenTtlSeconds);

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
      },
      session: { token: issued.token, expiresAt: issued.session.expiresAt },
    },
    200,
  );
});
