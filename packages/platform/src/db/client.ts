import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigurationError } from "@sport-os/shared";

/**
 * Service-role Supabase client factory (Section 03 — Service-Role
 * Security). This client BYPASSES ROW LEVEL SECURITY entirely — that is
 * exactly what the service role is for, and exactly why every function
 * in this package that accepts one is server-side-only code that
 * performs its OWN authorization check before using it (see
 * authorization.ts). Never import this module from apps/mini-app; never
 * pass a service-role client to code whose caller you have not already
 * authorized.
 */
export interface ServiceRoleClientOptions {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
}

export function createServiceRoleClient(options: ServiceRoleClientOptions): SupabaseClient {
  if (!options.supabaseUrl || !options.serviceRoleKey) {
    throw new ConfigurationError({ message: "Supabase service-role client requires both a URL and a service-role key." });
  }
  return createClient(options.supabaseUrl, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { SupabaseClient };
