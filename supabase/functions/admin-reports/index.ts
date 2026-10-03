// Supabase Edge Function (Deno runtime).
//
// GET  /admin-reports?ledgerMode=&limit=  -> bounded, newest-first
//      listing of weekly_reports rows (Section 11 §O/§S "Reports").
// POST /admin-reports { action: "generate", periodStart, periodEnd,
//      ledgerMode }  -> enqueues a WEEKLY_REPORT_GENERATION job rather
//      than generating synchronously inside the edge function. This
//      mirrors the whole job-system architecture (§E/§AD): report
//      generation runs through `WeeklyReportGenerationJobHandler` via
//      the durable job worker, never inline in an HTTP handler, so it
//      gets the same retry/idempotency/audit guarantees as every other
//      job type. The idempotency key here MUST match the one
//      `generateWeeklyReport` itself computes
//      (`weekly-report:{periodStart}:{periodEnd}:{ledgerMode}`) so a
//      duplicate "generate" request resolves to the SAME job row
//      instead of creating a second one (§AE).
//
// OWNER/ADMIN only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { bearerToken, corsHeaders, errorResponse, jsonResponse, readServerConfig, requireAdminRole, resolveAuthenticatedUser } from "../_shared/auth.ts";

const METHODS = "GET, POST, OPTIONS";
const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 50;
const VALID_LEDGER_MODES = new Set(["PAPER", "LIVE"]);

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
    const ledgerMode = url.searchParams.get("ledgerMode");
    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, LIST_LIMIT_MAX) : LIST_LIMIT_DEFAULT;

    let query = supabase
      .from("weekly_reports")
      .select("report_id, period_start, period_end, ledger_mode, report_version, status, generated_at, generated_by, supersedes_report_id, superseded_reason")
      .order("generated_at", { ascending: false })
      .limit(limit);
    if (ledgerMode && VALID_LEDGER_MODES.has(ledgerMode)) query = query.eq("ledger_mode", ledgerMode);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", "Could not load reports.", 500, headers);
    return jsonResponse({ reports: data ?? [] }, 200, headers);
  }

  if (req.method === "POST") {
    let body: { action?: string; periodStart?: string; periodEnd?: string; ledgerMode?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_PAYLOAD", "Request body must be JSON.", 400, headers);
    }

    if (body.action !== "generate" || !body.periodStart || !body.periodEnd || !body.ledgerMode) {
      return errorResponse("INVALID_PAYLOAD", 'Only {"action":"generate","periodStart":"...","periodEnd":"...","ledgerMode":"PAPER"|"LIVE"} is supported.', 400, headers);
    }
    if (!VALID_LEDGER_MODES.has(body.ledgerMode)) {
      return errorResponse("INVALID_PAYLOAD", 'ledgerMode must be "PAPER" or "LIVE".', 400, headers);
    }
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() <= periodStart.getTime()) {
      return errorResponse("INVALID_PAYLOAD", "periodStart/periodEnd must be valid ISO timestamps with periodEnd after periodStart.", 400, headers);
    }

    // Deterministic idempotency key — MUST match
    // `generateWeeklyReport`'s own computation exactly (see
    // packages/agents/src/weekly-report-service.ts) so a repeated
    // "generate" request for the same period/ledger_mode resolves to
    // the one existing job row instead of enqueueing a duplicate.
    const idempotencyKey = `weekly-report:${body.periodStart}:${body.periodEnd}:${body.ledgerMode}`;

    const { data: existingJob } = await supabase.from("operational_jobs").select("job_id, status").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingJob) {
      return jsonResponse({ jobId: existingJob.job_id, status: existingJob.status, alreadyExisted: true }, 200, headers);
    }

    const { data: created, error: insertError } = await supabase
      .from("operational_jobs")
      .insert({
        job_type: "WEEKLY_REPORT_GENERATION",
        status: "QUEUED",
        payload_reference: { periodStart: body.periodStart, periodEnd: body.periodEnd, ledgerMode: body.ledgerMode },
        max_attempts: 3,
        idempotency_key: idempotencyKey,
        created_by: resolvedUser.user.id,
      })
      .select("job_id, status")
      .single();
    if (insertError || !created) {
      // A unique-violation here means a concurrent request won the
      // race on the same idempotency key — resolve to that row rather
      // than surfacing an error, same "repeat request, same job" contract.
      const { data: raceWinner } = await supabase.from("operational_jobs").select("job_id, status").eq("idempotency_key", idempotencyKey).maybeSingle();
      if (raceWinner) return jsonResponse({ jobId: raceWinner.job_id, status: raceWinner.status, alreadyExisted: true }, 200, headers);
      return errorResponse("JOB_CREATE_FAILED", "Could not enqueue report generation.", 500, headers);
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_user_id: resolvedUser.user.id, action: "report_generated", resource_type: "weekly_report", resource_id: created.job_id, outcome: "success", metadata: { periodStart: body.periodStart, periodEnd: body.periodEnd, ledgerMode: body.ledgerMode, viaJobId: created.job_id } });
    if (auditError) console.error("admin-reports: best-effort audit write failed", auditError.message);

    return jsonResponse({ jobId: created.job_id, status: created.status, alreadyExisted: false }, 200, headers);
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Only GET/POST are supported.", 405, headers);
});
