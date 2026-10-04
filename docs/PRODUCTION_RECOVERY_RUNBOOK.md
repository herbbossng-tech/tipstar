# Production Recovery Runbook

Section 12 Part AV. 17 numbered disaster/failure scenarios, each with:
what happened, how to detect it, and the recovery procedure this
codebase's actual architecture supports. Where no safe automated
recovery exists, that is stated explicitly rather than invented.

## 1. Postgres/Supabase is completely unreachable

**Detect:** every Edge Function and `apps/worker`/`apps/bot` health
check returns `UNAVAILABLE`; `operational_health_check` jobs stop
completing.
**Recover:** this is an infrastructure-layer outage, not an
application bug — follow Supabase's own incident status; `apps/worker`
and `apps/bot` both retry/backoff rather than crash-loop (bounded
retries, never infinite); no application action restores a managed
Postgres outage. Once connectivity returns, `apps/worker` resumes
polling on its own next tick — no manual restart required unless the
process itself was killed by its supervisor during the outage.

## 2. A migration fails partway through a production deploy

**Detect:** deploy pipeline reports a non-zero exit from the migration
step.
**Recover:** Supabase's migration runner applies each migration inside
its own transaction — a failed migration leaves no partial DDL. Fix
the migration file, re-run migrations from that point. Never hand-edit
the already-applied portion of the schema outside a tracked migration
file. See `docs/PRODUCTION_DEPLOYMENT.md`'s rollback strategy.

## 3. A bad `apps/worker` deploy causes jobs to fail systematically

**Detect:** `operational_jobs` rows pile up in `FAILED`/repeatedly
`QUEUED` with a new `lastFailureCategory` pattern after a deploy.
**Recover:** redeploy the prior `apps/worker` build artifact (schema is
unaffected — jobs are durable rows, not lost). Once the good build is
running again, `claim_next_operational_job()` naturally picks up every
still-`QUEUED` job; any job stuck `RUNNING` past its lease timeout is
reclaimed automatically by the next claim attempt (`claim_next_operational_job()`'s
own stale-lease check — see `packages/platform/src/operations/jobs.ts`
TEST 13-15).

## 4. All `apps/worker` replicas crash simultaneously

**Detect:** no `OPERATIONAL_HEALTH_CHECK` job completes for longer than
`WORKER_SCHEDULER_TICK_MS` × 2; external process-supervisor alerting
(outside this repository) should be the primary signal.
**Recover:** restart at least one replica. Every job a crashed replica
had claimed but not finished is left `RUNNING` with a stale
`startedAt` — the next successful claim attempt by any replica
reclaims it past its lease timeout rather than leaving it stuck
forever. No manual SQL intervention needed. Attempts counts (and
`maxAttempts`) prevent an unrecoverable job from retrying forever.

## 5. A duplicate `WEEKLY_REPORT_GENERATION` job is somehow enqueued twice for the same period

**Detect:** two `operational_jobs` rows with the same
`idempotencyKey`.
**Recover:** this cannot actually happen — `createNext()`'s unique
index on `(jobType, idempotencyKey)` rejects the second insert at the
database level, and `runSchedulerTick()` checks
`findByIdempotencyKey()` before ever attempting to create one. If an
operator manually inserted a duplicate bypassing the application layer,
delete the extra row directly; `generateWeeklyReport()`'s own
`findCurrentForPeriod()` check would in any case refuse to create a
second FINALIZED report for the same period/mode without an explicit
`supersedesReportId`.

## 6. The Telegram Bot API is down and weekly report publication jobs are failing

**Detect:** `TELEGRAM_REPORT_PUBLICATION` jobs failing with
`INTEGRATION_UNAVAILABLE`/network-error categories.
**Recover:** the already-FINALIZED report itself is never affected (the
job only reads it) — once Telegram recovers, retry the job (admin
`/admin-jobs` retry endpoint, or let the worker's own retry/backoff
reach it). See the documented monitoring-gap finding in
`tests/e2e/section12-failure-injection.test.ts` if ALL destinations
failed silently (job reports `ok:true`) — check `audit_events` and the
actual Telegram channel for message absence if in doubt, since the job
status alone may not reveal a total outage.

## 7. A license was incorrectly revoked by an admin error

**Detect:** user reports lost access; `license-admin` audit trail shows
an unexpected `license_revoked` entry.
**Recover:** licenses are never destructively deleted — insert a new
ACTIVE license row (or use the existing reactivate/renew admin
operations where the status allows it) for the affected user. The
original revoked row and its audit entry remain as an immutable
historical record; this is a new corrective action, not a rewrite of
history.

## 8. A settlement was computed incorrectly due to a bad market rule

**Detect:** performance ledger/weekly report figures look wrong for a
specific fixture/market; manual review confirms the settlement rule
misfired.
**Recover:** settlement records are append-only with explicit
revisions — never patch the existing row. Issue a settlement revision
through the real settlement engine (preserving the original as
history), which naturally flows into a corrected performance ledger
entry on the next aggregation; a weekly report already generated for
that period is superseded with a new version
(`supersedesReportId`/`supersededReason`), never edited in place.

## 9. A secret (`SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, etc.) is suspected leaked

**Detect:** a secret appears in a log, a committed file, or a third
party's report.
**Recover:** rotate immediately — see `docs/OPERATIONS_RUNBOOK.md`'s
secret-rotation section for the exact per-secret procedure and
redeploy order. Treat any suspected leak as confirmed until proven
otherwise; rotation is cheap, a live-exploited leaked service-role key
is not.

## 10. A data-leakage regression is discovered in production predictions

**Detect:** a prediction is found to have used information not
actually available as of its stated `snapshotTime`.
**Recover:** this is a P0 — pull the affected model version from
active use immediately (via its `modelVersion`/policy gating, not a
code hotfix under pressure); audit every ticket/decision that used
that model version; re-run `packages/football-engine/src/leakage-guard.test.ts`
and `section-05-leakage.test.ts` against the suspected change before
re-enabling. Never ship a leakage fix without its own new regression
test (the exact discipline Sections 04/05 already established).

## 11. The job queue backs up faster than workers can drain it

**Detect:** `operational_jobs` in `QUEUED` grows without bound; job
age (`scheduledAt` to now) trends upward.
**Recover:** scale `apps/worker` horizontally — proven safe by the
concurrency guarantee (`docs/PRODUCTION_DEPLOYMENT.md`'s concurrency
proof). If the backlog is from one pathological job type repeatedly
failing and retrying, investigate that type's `lastFailureCategory`
first; a non-retryable category stuck in a retry loop would itself be
a bug worth filing, since this codebase's retry classification
(`packages/platform/src/operations/jobs.ts`) is designed to send
non-retryable failures straight to `FAILED`, never loop.

## 12. An admin account is compromised

**Detect:** unexpected admin-privileged mutations in `audit_events`
for an admin the real admin didn't perform.
**Recover:** immediately reactivate-then-reset or suspend the
compromised user's own license/role as appropriate; since every admin
action is audited with the real actor's resolved identity (never a
claimed one), the full blast radius is reconstructable from
`audit_events` — review and manually reverse any mutation found there
using the normal admin operations (never a direct SQL `UPDATE`,
which would itself be unaudited).

## 13. The Mini App static bundle is found to contain a leaked secret

**Detect:** a secret string found in a deployed `dist/assets/*.js`
file.
**Recover:** rotate the leaked secret immediately (it is now public);
this would also indicate a regression in the `@sport-os/config/client`
boundary — file it as a P0 code bug, add a build-artifact secret-scan
regression test for the exact import path that leaked it (mirroring
the existing scan documented in `docs/PRODUCTION_READINESS.md`), and
do not redeploy the Mini App until the scan is clean.

## 14. A webhook secret token mismatch locks out legitimate Telegram updates

**Detect:** `apps/bot` logs "Rejected webhook request with invalid
secret token" for genuine Telegram traffic; users report the bot not
responding.
**Recover:** confirm `TELEGRAM_WEBHOOK_SECRET` in the deployed
environment matches what was registered via Telegram's `setWebhook`;
if they've drifted (e.g. a secret rotation didn't re-register the
webhook), re-run `setWebhook` with the current secret. Long-polling
mode is the fallback for local/non-production use only — never enable
it in a production deployment with multiple replicas.

## 15. A weekly report was published with incorrect figures to a real Telegram channel

**Detect:** manual review of the published message against the
underlying performance ledger finds a discrepancy.
**Recover:** generate a corrected report version
(`supersedesReportId` pointing at the wrong one, with
`supersededReason` recorded) and publish a follow-up correction message
through the normal admin-triggered publish action — never edit or
delete the original Telegram message's underlying report record. The
original published message itself may be edited/deleted directly in
Telegram by a channel admin if policy requires it, which is outside
this application's control.

## 16. Disk/storage exhaustion on a deployed `apps/worker`/`apps/bot` host

**Detect:** process crashes with ENOSPC-style errors; host-level
monitoring (outside this repository).
**Recover:** this is an infrastructure concern — these are stateless
Node processes with no local persistent storage requirement beyond
logs; redeploy to a host with adequate disk, or configure log
rotation/shipping so logs don't accumulate locally. No application
data is at risk since all durable state lives in Postgres.

## 17. A full database restore from backup is required

**Detect:** unrecoverable data corruption or accidental mass deletion.
**Recover:** this repository does not implement its own backup system
— restore is Supabase's managed point-in-time-recovery or your own
`pg_dump`/`pg_restore` procedure, which is an infrastructure
responsibility this repository documents but does not provision (see
`docs/OPERATIONS_RUNBOOK.md`'s backup/recovery section for what is and
isn't covered). After any restore, before resuming traffic: re-run
`tests/database/run.sh` against a copy of the restored database to
confirm the schema/RLS/constraints are intact, and manually audit
`operational_jobs` for rows left `RUNNING` at the restore point (treat
them as stale and let the next claim attempt reclaim them).

---

**What this runbook does not cover:** scenarios requiring real
bookmaker/execution-integration recovery (no such integration exists)
and scenarios assuming a live production deployment currently exists
(none does — see `docs/PRODUCTION_READINESS.md`). This runbook is
written for the deployment this codebase supports, to be used the day
one is stood up.
