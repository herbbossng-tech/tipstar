import { useQuery, type QueryState } from "../hooks/useQuery.js";
import { fetchOwnProfile } from "./profileApi.js";
import type { UserProfile } from "./types.js";

/** The one place `/me` is fetched from (Section 09 — reused by Home and Account, replacing each page's own duplicate fetch logic from Section 03). */
export function useProfile(sessionToken: string): QueryState<UserProfile> & { readonly refetch: () => void } {
  return useQuery(() => fetchOwnProfile(sessionToken), [sessionToken]);
}
