import { apiRequest } from "../services/api.js";
import type { UserProfile } from "./types.js";

/** Fetches the caller's own safe profile, role, license, and entitlements from `/me` (Section 03). Never returns another user's data — the server resolves identity entirely from the session token. */
export async function fetchOwnProfile(sessionToken: string): Promise<UserProfile> {
  return apiRequest<UserProfile>("/me", { method: "GET", headers: { authorization: `Bearer ${sessionToken}` } });
}
