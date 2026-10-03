// Supabase Edge Function (Deno runtime).
//
// GET /admin-overview -> a bounded, real operational snapshot for the
// Mini App's /admin home screen (Section 11 §S "Admin Home"):
// active/expiring-soon license counts, queued/running job counts,
// recent job failures, recent reports, recent agent failures.
//
// OWNER/ADMIN only — this is role-gated, not entitlement-gated (§C:
// operational capabilities are a function of role, not a licensed
// feature). Every count here is a real `count(*)`/bounded `select`
// against the already-real Section 03/06/08/10/11 schema — nothing is
// computed or estimated in this function.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireAdminRole, resolveAuthenticatedUser } from "../_shared/auth.ts";

const METHODS = "GET, OPTIONS";

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(METHODS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported.", 405, headers);

  const token = bearerToken(req);
  if (!token) return errorResponse("SESSION_MISSING", "No session token was provided.", 401, headers);

  const config = readServerConfig(Deno.env);
  if (!config) return errorResponse("NOT_CONFIGURED", "This endpoint is not configured.", 500, headers);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const resolvedUser = await resolveAuthenticatedUser(supabase, token, config.sessionSigningSecret);
  if (!resolvedUser.ok) return errorResponse(resolvedUser.code, resolvedUser.message, resolvedUser.status, headers);

  const authz = requireAdminRole(resolvedUser.user);
  if (!authz.ok) return errorResponse(authz.code, authz.message, authz.status, headers);

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [activeLicenses, expiringLicenses, queuedJobs, runningJobs, failedJobs, recentReports, agentFailures] = await Promise.all([
    supabase.from("licenses").select("id", { count: "exact", head: true }).in("status", ["active", "trial"]),
    supabase.from("licenses").select("id", { count: "exact", head: true }).in("status", ["active", "trial"]).not("expires_at", "is", null).lte("expires_at", sevenDaysFromNow),
    supabase.from("operational_jobs").select("job_id", { count: "exact", head: true }).eq("status", "QUEUED"),
    supabase.from("operational_jobs").select("job_id", { count: "exact", head: true }).eq("status", "RUNNING"),
    supabase.from("operational_jobs").select("job_id", { count: "exact", head: true }).eq("status", "FAILED"),
    supabase.from("weekly_reports").select("report_id, period_start, period_end, ledger_mode, report_version, generated_at").order("generated_at", { ascending: false }).limit(5),
    supabase.from("agent_invocations").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  return jsonResponse(
    {
      activeLicenseCount: activeLicenses.count ?? 0,
      expiringLicenseCount: expiringLicenses.count ?? 0,
      queuedJobCount: queuedJobs.count ?? 0,
      runningJobCount: runningJobs.count ?? 0,
      recentFailedJobCount: failedJobs.count ?? 0,
      recentAgentFailureCount: agentFailures.count ?? 0,
      recentReports: (recentReports.data ?? []).map((row) => ({ reportId: row.report_id, periodStart: row.period_start, periodEnd: row.period_end, ledgerMode: row.ledger_mode, reportVersion: row.report_version, generatedAt: row.generated_at })),
      generatedAt: now.toISOString(),
    },
    200,
    headers,
  );
});
