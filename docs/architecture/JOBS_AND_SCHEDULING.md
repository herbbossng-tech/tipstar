# Jobs & Scheduling (Section 11 Parts E-I, AC-AE)

## Purpose

Section 10 identified synchronous, inline Telegram publishing as a
limitation (`OPEN_QUESTIONS.md` #30). Section 11 builds the durable job
abstraction that was missing — a **simple, reliable Postgres-backed job
runner**, explicitly not a distributed queue product.

## The job record

`operational_jobs` (`supabase/migrations/20261002190100_operational_jobs.sql`)
mirrors `OperationalJobRecord` (`packages/platform/src/operations/jobs.ts`)
field-for-field: `jobId`, `jobType`, `status`, `payloadReference`
(a reference, never a secret), `scheduledAt`/`startedAt`/`completedAt`,
`attempts`/`maxAttempts`/`nextAttemptAt`, `lastError`/
`lastFailureCategory`, `idempotencyKey`, `createdBy` (a user id or the
literal string `"system"` — never a foreign key, and never read back as
authorization proof), `createdAt`/`updatedAt`.

## State machine

```
QUEUED  -> RUNNING | CANCELLED
RUNNING -> SUCCEEDED | FAILED | CANCELLED | QUEUED   (automatic retry — one round trip)
FAILED  -> QUEUED                                     (explicit ADMIN retry action)
SUCCEEDED | CANCELLED -> (terminal)
```

Two different paths lead back to QUEUED for two different real-world
triggers: `RUNNING -> QUEUED` is the worker's own automatic retry of a
transient failure (never passing through FAILED); `FAILED -> QUEUED` is
an explicit admin action on a job that already landed on permanent
FAILED. Both are validated by `isValidJobTransition()`; the database's
own CHECK constraint is a defense-in-depth mirror, never the primary
enforcement.

## Atomic claiming

`claim_next_operational_job(p_job_type, p_now, p_lease_timeout_ms)`
(Postgres function) is the **only** way a worker claims a job — never a
client-side SELECT-then-UPDATE. It uses `FOR UPDATE SKIP LOCKED` to let
concurrent callers each land on a different eligible row instead of
blocking on each other (extending, not just copying, Section 03's
`claim_owner_bootstrap()` atomic-UPDATE precedent, which never needed
`SKIP LOCKED` because it only ever had one eligible row). A job is
eligible when it's QUEUED and due, **or** RUNNING past its lease
timeout — a stale-RUNNING job (a worker that crashed mid-execution) is
automatically reclaimed this way, never left stuck forever.

## The four job types (Part F — no fake handlers)

| Job type | Handler | What it does |
|---|---|---|
| `PERFORMANCE_SNAPSHOT` | `PerformanceSnapshotJobHandler` | Reads real `settlements`/`tickets`/`settlement_legs`, calls the existing `buildPerformanceLedgerEntry()`, upserts `performance_ledger` |
| `WEEKLY_REPORT_GENERATION` | `WeeklyReportGenerationJobHandler` | Calls `generateWeeklyReport()` (see `WEEKLY_REPORTING.md`) |
| `TELEGRAM_REPORT_PUBLICATION` | `TelegramReportPublicationJobHandler` | Dispatches a real `AgentOrchestrator` COMMAND to `TelegramChannelManagementAgent` |
| `OPERATIONAL_HEALTH_CHECK` | `OperationalHealthCheckJobHandler` | Runs bounded, real probes and records an audit event |

An unregistered job type (or a job type the deployed worker's handler
list doesn't include) fails safely and permanently
(`JobFailureCategory.INVALID_PAYLOAD`) — `OperationalJobWorker.runOnce()`
never throws or silently drops it.

## The worker pipeline (Part AD)

```
FETCH QUEUED JOB -> CLAIM ATOMICALLY -> VALIDATE JOB TYPE
-> RESOLVE SYSTEM/AUTHORIZED CONTEXT -> EXECUTE EXISTING DOMAIN SERVICE
-> RECORD SUCCESS/FAILURE -> SCHEDULE RETRY IF SAFE -> AUDIT
```

`OperationalJobWorker.runOnce(jobType)` claims **at most one** job of the
given type per call — the caller (a scheduled tick) decides how often to
call it, never the worker itself. Every claim, success, retry, and
permanent failure is recorded via the existing `AuditService` (`job_claimed`/
`job_succeeded`/`job_retried`/`job_failed`).

**Never does the worker:** bypass RLS via a client-side call, call an
execution adapter directly, bypass `GlobalExecutionGate`, fabricate a
provider response, mutate settlement/report/audit history, or read
`job.payloadReference`/`job.createdBy` as proof of authorization (see
`SECTION11 ADVERSARIAL G` for the test proving this).

## Safe retry (Part I)

A **job-level** `JobFailureCategory`/`isRetryableJobFailure()` exists
separately from the Section 06 **agent-level** `FailureDisposition` —
two different state machines for two different kinds of thing, both
reused as-is where they already apply. Retryable: `DATA_UNAVAILABLE`,
`TIMEOUT`, `INTEGRATION_UNAVAILABLE`, `TRANSIENT_DEPENDENCY_FAILURE`.
Permanent (never retried, however many attempts remain):
`AUTHORIZATION_DENIED`, `INVALID_PAYLOAD`, `POLICY_REJECTED`, and any
category once `attempts >= maxAttempts`. `computeNextAttemptDelayMs()`
backs off exponentially; a retry always generates a new attempt while
preserving the job's own lineage (`jobId`, `idempotencyKey`) — it never
rewrites history.

## Idempotency (Part AE)

Every job has a unique `idempotencyKey`, enforced by a real Postgres
unique index (`operational_jobs_idempotency_key_idx`) — never only an
in-memory check. The weekly report job's key is deterministic:
`weekly-report:{periodStart}:{periodEnd}:{ledgerMode}`. Telegram report
publication reuses Section 10's own publication idempotency model
(`telegram_publications`'s natural-key unique index) — Section 11 adds
no second idempotency mechanism for that step.

## Known limitation: no deployed scheduler process

`OperationalJobWorker` and all four handlers are real and tested, but
**no standalone process exists that calls `runOnce()` on an interval**.
Nothing in `apps/` runs a loop today. This is a deliberate scope
boundary for this section (adding a new deployable worker binary,
its process supervision, and its own configuration would be a
significant addition beyond "build the durable job abstraction"), not
an oversight — see `OPEN_QUESTIONS.md`'s new entry on this. The admin
`admin-reports` Edge Function enqueues real `WEEKLY_REPORT_GENERATION`
jobs today; they will run as soon as a worker loop calls
`OperationalJobWorker.runOnce("WEEKLY_REPORT_GENERATION")` against the
same database, with zero code changes required.
