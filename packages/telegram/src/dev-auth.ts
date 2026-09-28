import type { Environment } from "@sport-os/shared";
import type { AuthenticatedTelegramIdentity } from "./types.js";

/**
 * DEVELOPMENT ONLY (Section 02). A fixed, clearly-marked synthetic
 * identity — never a client-supplied Telegram id. `isDevAuthModeUsable`
 * is the single gate every caller (the Edge Function, tests) must check
 * before honoring a dev-auth request; it re-derives "not production"
 * itself rather than trusting a caller's own check, so there is no path
 * where a misconfigured caller alone can enable this in production.
 */
const DEV_IDENTITY_TELEGRAM_USER_ID = 999_999_999;

export function isDevAuthModeUsable(appEnv: Environment, devAuthMode: "enabled" | "disabled"): boolean {
  return appEnv !== "production" && devAuthMode === "enabled";
}

/** Always the same fixed values — this is not parameterized by anything the caller supplies. */
export function buildDevAuthenticatedIdentity(now: Date = new Date()): AuthenticatedTelegramIdentity {
  return {
    telegramUserId: DEV_IDENTITY_TELEGRAM_USER_ID,
    firstName: "Dev",
    lastName: "User",
    username: "dev_user_do_not_use_in_production",
    languageCode: "en",
    isPremium: false,
    authDate: now.toISOString(),
    verifiedAt: now.toISOString(),
    authMode: "dev",
  };
}
