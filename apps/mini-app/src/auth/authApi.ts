import { apiRequest } from "../services/api.js";
import type { AuthenticatedIdentity, AuthSessionHandle } from "./types.js";

interface TelegramAuthResponse {
  readonly identity: AuthenticatedIdentity;
  readonly session: AuthSessionHandle;
}

/**
 * Exchanges raw Telegram `initData` for a server-verified identity +
 * session token. The server is the only place this is ever trusted — see
 * docs/architecture/TELEGRAM_AUTHENTICATION.md. Never call this with
 * `initDataUnsafe` fields; only the opaque raw string from
 * TelegramWebAppClient.getRawInitData() belongs here.
 */
export async function authenticateWithTelegram(rawInitData: string): Promise<TelegramAuthResponse> {
  return apiRequest<TelegramAuthResponse>("/telegram-auth", { method: "POST", body: { initData: rawInitData } });
}

/**
 * Only reachable when the Mini App is built with dev-mode auth enabled
 * (clientConfig.devAuthModeEnabled) — the server independently re-verifies
 * DEV_AUTH_MODE + non-production and always returns a fixed synthetic
 * identity, never one derived from client input.
 */
export async function authenticateWithDevMode(): Promise<TelegramAuthResponse> {
  return apiRequest<TelegramAuthResponse>("/telegram-auth", { method: "POST", body: { mode: "dev" } });
}

/**
 * Calls `/owner-bootstrap` (Section 03) with the caller's own already-
 * authenticated session and the server-only `OWNER_BOOTSTRAP_SECRET`.
 * Succeeds at most once ever, for whichever caller gets there first —
 * the server disables the endpoint permanently afterward
 * (`platform_settings.owner_bootstrapped_at`). Never exposes the secret
 * value itself to any other caller or log.
 */
export async function bootstrapOwner(sessionToken: string, secret: string): Promise<void> {
  await apiRequest<unknown>("/owner-bootstrap", { method: "POST", headers: { authorization: `Bearer ${sessionToken}` }, body: { secret } });
}
