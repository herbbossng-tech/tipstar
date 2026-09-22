import { createHmac, timingSafeEqual } from "node:crypto";
import { ErrorCodes, TipstarError, type Result, err, ok } from "@tipstar/shared";
import type { IssuedSession, TipstarSessionClaims } from "./types.js";

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

function base64url(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64url");
}

function sign(headerAndPayload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(headerAndPayload).digest());
}

/**
 * Issues a compact HS256 JWT carrying `TipstarSessionClaims`.
 *
 * The signing secret MUST be the Supabase project's JWT secret
 * (`TIPSTAR_JWT_SECRET`) so PostgREST — which validates any JWT signed
 * with that same secret — accepts this token as an authenticated request
 * and exposes its claims via `request.jwt.claims`, which
 * `tipstar_auth_user_id()` reads (see supabase/migrations). This is how
 * RLS enforces "a user may only read their own row" without Supabase's
 * built-in email/OAuth auth.
 */
export function issueSessionToken(
  claims: Omit<TipstarSessionClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number,
  now: Date = new Date(),
): IssuedSession {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const fullClaims: TipstarSessionClaims = { ...claims, iat, exp };

  const headerAndPayload = `${base64url(JSON.stringify(JWT_HEADER))}.${base64url(JSON.stringify(fullClaims))}`;
  const signature = sign(headerAndPayload, secret);

  return {
    accessToken: `${headerAndPayload}.${signature}`,
    tokenType: "bearer",
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Verifies a session token issued by `issueSessionToken`: signature,
 * structure, and expiry. Never trust a session token's claims without
 * calling this first.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Result<TipstarSessionClaims, TipstarError> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return err(new TipstarError({ code: ErrorCodes.SESSION_INVALID, message: "Session token is malformed." }));
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const expectedSignature = sign(`${headerPart}.${payloadPart}`, secret);
  const signatureBuffer = Buffer.from(signaturePart, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  const signatureValid =
    signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!signatureValid) {
    return err(new TipstarError({ code: ErrorCodes.SESSION_INVALID, message: "Session token signature is invalid." }));
  }

  let claims: TipstarSessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as TipstarSessionClaims;
  } catch {
    return err(new TipstarError({ code: ErrorCodes.SESSION_INVALID, message: "Session token payload could not be parsed." }));
  }

  if (
    typeof claims.sub !== "string" ||
    typeof claims.tipstar_user_id !== "string" ||
    typeof claims.telegram_user_id !== "number" ||
    claims.role !== "authenticated" ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number"
  ) {
    return err(new TipstarError({ code: ErrorCodes.SESSION_INVALID, message: "Session token claims are invalid." }));
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds > claims.exp + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return err(new TipstarError({ code: ErrorCodes.SESSION_EXPIRED, message: "Session has expired. Please reopen Tipstar." }));
  }

  return ok(claims);
}
