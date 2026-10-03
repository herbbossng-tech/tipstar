import type { UserProfile } from "./types.js";

/**
 * The one place a screen checks "does this account have feature X"
 * (Section 09 §30 — "UI gating is NOT authorization"). Reads ONLY the
 * server's own `/me` response — there is no separate, locally-stored
 * permission flag anywhere in this codebase that could be tampered with
 * independently of what the server actually reports. Every protected
 * request this function's result gates ALSO re-checks the same
 * entitlement server-side (`requireEntitlement`, `supabase/functions/
 * _shared/auth.ts`) — this function only ever decides what to render,
 * never what a request is allowed to do.
 */
export function hasEntitlement(profile: UserProfile | undefined, featureKey: string): boolean {
  return profile?.entitlements.includes(featureKey) ?? false;
}
