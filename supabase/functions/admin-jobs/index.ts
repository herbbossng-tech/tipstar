// Supabase Edge Function (Deno runtime).
//
// GET  /admin-jobs?status=&jobType=  -> bounded, newest-first listing
//      of operational_jobs (Section 11 §S "Jobs").
// POST /admin-jobs { action: "retry", jobId }  -> re-queues a job that
//      is currently FAILED. Retry is permitted ONLY for a job already
//      in the FAILED state (the job system's own locked state machine,
//      `isValidJobTransition`, allows exactly FAILED -> QUEUED as an
//      explicit admin action — see `@sport-os/platform`'s `jobs.ts`).
//      Never retries a QUEUED/RUNNING/SUCCEEDED/CANCELLED job, and never
//      bumps past `max_attempts`.
//
// OWNER/ADMIN only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireAdminRole, resolveAuthenticatedUser } from "../_shared/auth.ts";

const METHODS = "GET, POST, OPTIONS";
const LIST_LIMIT = 50;
const VALID_STATUSES = new Set(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(METHODS);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const token = bearerToken(req);
  if (!token) return errorResponse("SESSION_MISSING", "No session token was provided.", 401, headers);

  const config = readServerConfig(Deno.env);
  if (!config) return errorResponse("NOT_CONFIGURED", "This endpoint is not configured.", 500, headers);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const resolvedUser = await resolveAuthenticatedUser(supabase, token, config.sessionSigningSecret);
  if (!resolvedUser.ok) return errorResponse(resolvedUser.code, resolvedUser.message, resolvedUser.status, headers);

  const authz = requireAdminRole(resolvedUser.user);
  if (!authz.ok) return errorResponse(authz.code, authz.message, authz.status, headers);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const jobType = url.searchParams.get("jobType");

    let query = supabase.from("operational_jobs").select("job_id, job_type, status, scheduled_at, started_at, completed_at, attempts, max_attempts, next_attempt_at, last_error, last_failure_category, created_by, created_at").order("created_at", { ascending: false }).limit(LIST_LIMIT);
    if (statusParam && VALID_STATUSES.has(statusParam)) query = query.eq("status", statusParam);
    if (jobType) query = query.eq("job_type", jobType);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", "Could not load jobs.", 500, headers);
    return jsonResponse({ jobs: data ?? [] }, 200, headers);
  }

  if (req.method === "POST") {
    let body: { action?: string; jobId?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_PAYLOAD", "Request body must be JSON.", 400, headers);
    }
    if (body.action !== "retry" || !body.jobId) {
      return errorResponse("INVALID_PAYLOAD", 'Only {"action":"retry","jobId":"..."} is supported.', 400, headers);
    }

    const { data: job, error: readError } = await supabase.from("operational_jobs").select("job_id, status, attempts, max_attempts").eq("job_id", body.jobId).maybeSingle();
    if (readError || !job) return errorResponse("JOB_NOT_FOUND", "No job found with that id.", 404, headers);
    if (job.status !== "FAILED") return errorResponse("RETRY_NOT_PERMITTED", `A job may only be retried from FAILED (current status: "${job.status}").`, 409, headers);

    const { data: updated, error: updateError } = await supabase.from("operational_jobs").update({ status: "QUEUED", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("job_id", body.jobId).select("job_id, status").single();
    if (updateError || !updated) return errorResponse("RETRY_FAILED", "Could not retry this job.", 500, headers);

    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_user_id: resolvedUser.user.id, action: "job_retried", resource_type: "operational_job", resource_id: body.jobId, outcome: "success", metadata: { initiatedBy: "admin" } });
    if (auditError) console.error("admin-jobs: best-effort audit write failed", auditError.message);

    return jsonResponse({ jobId: updated.job_id, status: updated.status }, 200, headers);
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Only GET/POST are supported.", 405, headers);
});
