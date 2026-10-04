# Operations Runbook

Section 12 Part AZ. Day-to-day operational procedures. For disaster
scenarios, see `docs/PRODUCTION_RECOVERY_RUNBOOK.md`; for how to deploy
from nothing, see `docs/PRODUCTION_DEPLOYMENT.md`.

## Daily/routine checks

- **Job health**: query `operational_jobs` for `status = 'FAILED'` rows
  newer than the last check, and for any `RUNNING` row whose
  `startedAt` is older than the job type's expected lease — either
  signals a problem worth investigating before it self-heals.
- **Weekly report generation**: confirm a `WEEKLY_REPORT_GENERATION` job
  completed for the prior period on schedule (the scheduler enqueues it
  idempotently every tick once the period has elapsed — see
  `apps/worker/src/scheduler.ts`).
- **Operational health check**: the `OPERATIONAL_HEALTH_CHECK` job's
  own result is the fastest single signal for subsystem status
  (HEALTHY/DEGRADED/UNAVAILABLE/NOT_CONFIGURED/UNKNOWN per subsystem) —
  review it before assuming "no alerts" means "healthy," since
  `NOT_CONFIGURED`/`UNKNOWN` are not alerts but are also not "fine."

## Health check status meanings

| Status | Meaning | Action |
|---|---|---|
| `HEALTHY` | The subsystem was actually probed and responded correctly. | None. |
| `DEGRADED` | The subsystem responded, but outside a normal/expected range. | Investigate; not yet an outage. |
| `UNAVAILABLE` | The subsystem was probed and failed/timed out. | Investigate immediately — this is a real failure. |
| `NOT_CONFIGURED` | The integration is intentionally not set up in this environment (e.g. no live provider). | Expected in non-production or pre-launch — never treat as an outage. |
| `UNKNOWN` | No probe was supplied for this subsystem (e.g. `apps/worker` wired without `settlementsConnectivityProbe`). | Confirm this is intentional for the environment; a production deployment should wire a real probe for every subsystem that has one available. |

`NOT_CONFIGURED` and `UNKNOWN` are never silently reported as
`HEALTHY` — this is covered by regression tests in
`packages/agents/src/jobs/operational-health-check-job.test.ts` (7
tests) and is a hard rule from Section 11 (§Q) re-verified unchanged in
Section 12.

## Retrying a failed job

Admin-triggered retry (via the `admin-jobs` Edge Function / Mini App
`/admin` UI) is the sanctioned path — it is rate-limited
(`createFixedWindowRateLimiter(10, 60)`) and audited. Only jobs whose
`JobFailureCategory` is retryable should be retried blindly; a
permanently-failed category (authorization/policy/license/invalid
payload) retrying without first fixing the underlying cause will just
fail again — check `lastError`/`lastFailureCategory` first.

## Publishing a weekly report

Weekly report generation is fully automatic (the scheduler enqueues
it). **Publication to Telegram is NOT automatic** — this is a
deliberate design decision (see `supabase/functions/admin-reports/index.ts`'s
own doc comment): `PublishingAuthorizer` requires a real, licensed
identity to authorize a publish, and no "system publishing identity"
concept exists in the locked architecture. An admin must explicitly
trigger publication (`action: "publish"` on `admin-reports`, or the
Mini App's `/admin` reports page "Publish" button, shown only for
`FINALIZED` reports) — rate-limited to 5/minute, shared with report
generation.

## Secret rotation

**Never print a real secret value in a terminal, log, chat, or commit
while rotating it.** Rotate via your secrets manager / hosting
platform's secret store directly.

| Secret | Rotation procedure | Redeploy required after rotation |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in the Supabase project dashboard. | Every Edge Function, `apps/bot`, `apps/worker` — all read it at process startup. |
| `TELEGRAM_BOT_TOKEN` | Generate a new token via `@BotFather`'s `/revoke` + reissue, or create a fresh bot if a full identity change is needed. | `apps/bot`, every Edge Function that calls the Telegram Bot API (`admin-reports` publish path, etc.). Re-register the webhook after rotation. |
| `TELEGRAM_WEBHOOK_SECRET` | Generate a new random value. | `apps/bot` (update env), then re-run Telegram's `setWebhook` with the new `secret_token` — until both sides match, `apps/bot` will reject real Telegram traffic (see Recovery Runbook #14). |
| `SESSION_SIGNING_SECRET` | Generate a new random value. | Every Edge Function that issues/verifies session tokens. **Every currently-issued session token is invalidated** — users must re-authenticate through Telegram; this is expected and safe, never a data-loss event. |
| `OWNER_BOOTSTRAP_SECRET` | Rotate or unset entirely once bootstrap is no longer needed (unset is the safe default — see `docs/architecture/AUTHORIZATION.md`). | Only the `owner-bootstrap` Edge Function. |
| `FOOTBALL_DATA_API_KEY` / `ODDS_API_KEY` / `AVIATOR_DATA_API_KEY` | Rotate with the respective provider. | Whatever process reads provider config (none of these providers are actually wired to a live integration as of Section 12 — see `docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md`). |

Rotate on a fixed schedule (recommend quarterly at minimum) and
immediately on any suspected leak (see Recovery Runbook #9).

## Backup and recovery boundaries

This repository does not implement its own backup mechanism. What
exists:

- **Database**: relies entirely on Supabase's managed backup/point-in-
  time-recovery, or an operator-run `pg_dump` schedule — neither is
  configured by anything in this repository. Document your chosen
  RPO/RTO alongside your actual Supabase plan's backup retention.
- **Application state**: `apps/bot` and `apps/worker` are stateless —
  nothing to back up beyond their environment configuration (which
  should live in the secrets manager, itself separately backed up by
  that platform).
- **Migrations**: `supabase/migrations/*.sql` is the durable, version-
  controlled source of truth for schema — a database can always be
  rebuilt from them (see `tests/database/run.sh`, which does exactly
  this against a scratch database on every run), but migrations alone
  do not restore DATA, only schema.

## Monitoring and observability

- **Structured logs**: `StructuredLogger` (`@sport-os/shared`) emits
  JSON with `timestamp`, `service`, `severity`, `message`, and
  caller-supplied metadata — every log call site is reviewed to never
  include `initData`, session tokens, or secret values (Section 12
  Part Y audit, no violations found).
- **Correlation**: `correlationId`/`invocationId` thread through
  agent dispatch, job records, and audit events — use them to trace one
  logical operation across process boundaries (e.g. a scheduler tick →
  its enqueued job → the job's agent dispatch → its audit event).
- **Audit trail**: `audit_events` is the durable, queryable record of
  every security-relevant action (admin mutations, execution gate
  denials, license changes) — the first place to look when
  investigating "who did what."
- **Baseline metrics available today**: job counts by status/type
  (`operational_jobs`), weekly report generation success/failure rate,
  per-subsystem health check status history. No external metrics
  backend (Prometheus/Datadog/etc.) is wired — these are all queryable
  directly from Postgres today, which is an honest boundary, not a
  gap to hide: a production deployment should decide its own metrics
  export story, this repository does not assume one.

## Production smoke-test checklist

Run after every deploy, before directing real user traffic. No item
here requires real-money execution.

1. `apps/mini-app`'s built bundle loads and shows the auth boundary for
   an unauthenticated visitor.
2. A real Telegram `initData` payload (from the actual bot) authenticates
   successfully end to end.
3. An authenticated user with no license sees the correct "no license"
   state, never a crash.
4. An authenticated user with an active license sees their real license
   status.
5. `GET supabase/functions/health` returns 200 with honest subsystem
   statuses (not fabricated HEALTHY).
6. The bot responds to `/start` and `/help` in both webhook and (non-
   production) long-poll mode.
7. `/status`, `/account` return the real, resolved identity's own data.
8. A non-admin's `/admin*` commands are denied, never silently ignored
   without a reply.
9. An admin's `/adminjobs`, `/adminreports`, `/adminagents` return real
   data from the database, not placeholders.
10. `apps/worker` logs "Worker started" with the expected poll/tick
    intervals.
11. A manually-enqueued test job is claimed and completed by
    `apps/worker` within one poll interval.
12. The scheduler's first tick after startup enqueues the expected job
    types without duplicating an already-existing one for the same
    period.
13. `SIGTERM` to `apps/worker` results in a clean "Worker stopped" log
    line and process exit 0, not a hang or crash.
14. A real settled ticket's figures appear correctly in the next
    performance ledger read.
15. A FINALIZED weekly report can be viewed by an admin but is not
    auto-published.
16. An admin's explicit "Publish" action on a FINALIZED report results
    in a real Telegram message in the test destination.
17. RLS denies a direct PostgREST request using the anon key for any
    write operation across every table.
18. The Mini App's built bundle, grepped for the real
    `SUPABASE_SERVICE_ROLE_KEY`/`TELEGRAM_BOT_TOKEN`/`SESSION_SIGNING_SECRET`
    values configured for that environment, contains none of them.
19. `npm run build` across every workspace completes with exit 0 from
    a clean `npm ci`.

## Escalation

This repository does not define an on-call rotation or paging policy —
that is an organizational decision outside its scope. What it provides
is the diagnostic surface (audit trail, health checks, correlation
IDs, structured logs) an on-call responder needs once a policy exists.
