# Operations Security (Section 11 Parts G, P, Q, V, W)

## Frontend gating is cosmetic

`AdminGuard` (Mini App) and the bot's `/admin*` command set only hide UI
from a non-admin — they are **never** the authorization boundary. Every
`admin-*` Edge Function independently re-verifies the caller's session
and role server-side (`resolveAuthenticatedUser` + `requireAdminRole`,
`supabase/functions/_shared/auth.ts`), and every bot admin handler calls
the real `requireAdmin()` against the identity `identify()` resolves
from `ctx.from` — never from a command argument.

## Job payloads are never authorization

`OperationalJobWorker` never reads `job.payloadReference` or
`job.createdBy` as a role/identity grant. `job.createdBy` is a plain
string (a user id, or the literal `"system"`) recorded for audit
lineage only; nothing in the worker or any handler branches on it to
decide what it's allowed to do. A job handler that needs to act on
behalf of a specific user (none currently do) would have to resolve
that user's real authorization independently, exactly like every other
service-role-backed operation in this codebase.
`SECTION11 ADVERSARIAL G` proves this directly: a job claimed with a
payload claiming `{role:"OWNER", isAdmin:true}` is handed to its
handler unexamined by the worker — the worker itself never reads those
fields.

## No forged actor, no forged role

- A Telegram command's `ctx.from` is the only identity source bot
  commands trust — never an argument, never a callback payload.
- Every Edge Function resolves the caller from their verified session
  token, never an `Authorization`-adjacent header value a client could
  set arbitrarily.
- `inspectUserForAdmin`'s authorization depends only on the real
  `actingUser` parameter — a destinations repository fake "claiming" the
  target user owns admin-looking data changes nothing about who is
  authorized to call it (`SECTION11 ADVERSARIAL E/F`).

## No secret ever reaches an operational view

- `getPlatformSettingsSnapshot()`'s return type carries only booleans
  and non-secret strings — `platform-settings-admin.test.ts` TEST 4
  asserts no key matches `/token|secret|key$|credential/i`.
- `SECTION11 ADVERSARIAL R` asserts the same across every export of
  `@sport-os/platform` reachable from the admin surfaces: no name
  matches `bottoken|sessionsecret|servicerolekey|privatekey`.
- The `admin-jobs`/`admin-reports`/`admin-overview` Edge Functions select
  only named, non-secret columns — never `select("*")` on a table that
  could carry a sensitive field.

## Audit is append-only

`AuditService.record()` is the only write path; no function in this
section's code issues an `UPDATE`/`DELETE` against `audit_logs`. The
same destinations/jobs/reports mutation vocabulary Section 03/10
established is extended, never replaced: `job_claimed`/`job_succeeded`/
`job_retried`/`job_failed`, `license_renewed`/`license_reactivated`,
`report_generated`, `operational_health_check`/`health_check_failure`.

## Health reporting never fakes availability

`evaluateOperationalHealth()` is a pure function over caller-supplied
probe results — it performs no I/O itself. `OperationalHealthCheckJobHandler`
only ever reports:

- `HEALTHY`/`UNAVAILABLE` for the subsystems it actually probes
  (database/job-runner via `operational_jobs`, agent framework via
  `agent_invocations`, reporting via `performance_ledger`) — a thrown
  error becomes `UNAVAILABLE`, never silently swallowed into `HEALTHY`.
- `NOT_CONFIGURED` for an integration the caller-supplied config flag
  says isn't configured — never `HEALTHY`.
- `UNKNOWN` for an integration that is configured but that this check
  does not make an outbound call to verify — never a fabricated
  `HEALTHY` for a reachability nobody actually tested.
- `UNKNOWN` for the settlement subsystem specifically, since no
  dedicated probe is wired yet — an honest gap, not a fake signal.

Health checks never mutate production business state — every probe used
is a bounded read already present elsewhere in this codebase.

## Safe retry only

Only `DATA_UNAVAILABLE`/`TIMEOUT`/`INTEGRATION_UNAVAILABLE`/
`TRANSIENT_DEPENDENCY_FAILURE` job failures are retried automatically,
and a FAILED job is retryable by an admin action only from the FAILED
state (`admin-jobs`'s POST handler checks this server-side before
re-queuing, independent of whatever the UI showed). `AUTHORIZATION_DENIED`/
`INVALID_PAYLOAD`/`POLICY_REJECTED` failures, and any job that has
exhausted `maxAttempts`, are never retried — not automatically, and not
via the admin retry action, which the backend refuses with
`RETRY_NOT_PERMITTED` for any job not currently FAILED.

## No duplicate authority

- No second `GlobalExecutionGate`, no second `AgentOrchestrator`, no
  second license state machine, no second Telegram publishing pipeline.
- `getAgentOperationsSummary()` exposes read-only counts over the
  existing agent framework and exposes **no** retry/re-run of an
  invocation directly — `SECTION11 ADVERSARIAL V` asserts no exported
  name from `agent-operations.ts` matches `/retry|rerun|reexecute/i`. A
  job retry (via the job system only) is the one retry surface.
- `canPerform()` (the authorization matrix) is read-only/presentation-only
  — `requireAdmin()`/`requireOwner()` at each real call site remain the
  sole authority.

## Adversarial coverage

`packages/agents/src/section11-adversarial.test.ts` and the per-module
test suites (`jobs.test.ts`, `authorization-matrix.test.ts`,
`license-admin.test.ts`, `platform-settings-admin.test.ts`,
`operational-health.test.ts`, `worker.test.ts`,
`weekly-report-service.test.ts`, `agent-operations.test.ts`,
`operational-health-check-job.test.ts`) cover: non-admin denial on
every admin surface, forged user id / forged role never granting
authorization, a job payload claiming a role never being read as one,
report regeneration never silently overwriting, permanent/policy
failures never retried, no secret-shaped field anywhere in an
operational DTO, and the health evaluator never reporting a fabricated
`HEALTHY`. `tests/database/160_section11_rls_cases.sql` (19 cases)
covers the same ground at the real-Postgres RLS layer — see that file
for the full numbered list.
