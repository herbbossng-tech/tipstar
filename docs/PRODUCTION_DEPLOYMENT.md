# Production Deployment

Section 12 Part AY. Supersedes `docs/deployment/DEPLOYMENT.md` (Section
01's foundation-only note, kept for history) with the real, current
deployment picture now that every subsystem through Section 11 exists
and `apps/worker` (Section 12) closes the "no deployed job-running
process" gap `docs/architecture/OPEN_QUESTIONS.md` #33 flagged.

**No production deployment of this system currently exists.** This
document describes how to deploy it correctly — it does not claim any
environment is live, has measured production load, or has been
operated in production. Every claim below is either a verified local
fact (this repository's build/test/migration behavior) or an explicit
instruction for infrastructure this repository does not provision
(Supabase project, hosting, DNS, TLS).

## Components to deploy

| Component | What it is | How to run it | Replicas safe? |
|---|---|---|---|
| `apps/mini-app` | Static Vite/React build | `npm run build --workspace=apps/mini-app`, serve `dist/` from any static host/CDN behind HTTPS | Yes (stateless static assets) |
| `apps/bot` | Node Telegram bot process | `npm run build --workspace=apps/bot && node apps/bot/dist/index.js`, webhook mode in production (`TELEGRAM_WEBHOOK_SECRET` set, `setWebhook` registered) behind an HTTPS endpoint | Not with long-polling (exactly one process may long-poll); yes in webhook mode behind a load balancer, since grammy's webhook handler is itself stateless per-request |
| `apps/worker` | Node job worker + scheduler process (Section 12) | `npm run build --workspace=apps/worker && node apps/worker/dist/index.js` | **Yes, by design** — `claim_next_operational_job()`'s `FOR UPDATE SKIP LOCKED` is what makes concurrent replicas safe, proven under real concurrent Postgres connections (see "Concurrency proof" below). Each replica also runs its own scheduler tick; `runSchedulerTick()`'s own idempotency key (period + job type) means duplicate ticks across replicas are a no-op, never a duplicate job. |
| `supabase/functions/*` | Deno Edge Functions (auth, admin, reports, jobs, health, etc.) | `supabase functions deploy <name>` per function | Yes (Supabase manages scaling) |
| Postgres (Supabase) | Schema + RLS + migrations | `supabase/migrations/*.sql` applied in filename order (62 migrations as of Section 12) | N/A (managed by Supabase) |

## Environment variables

See `docs/environment-variables.md` for the full table. Two new
non-secret variables exist as of Section 12, both optional with safe
defaults:

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_POLL_INTERVAL_MS` | `5000` | How often `apps/worker` polls for a claimable job when idle. |
| `WORKER_SCHEDULER_TICK_MS` | `60000` | How often `apps/worker` runs its internal scheduler tick (weekly-report + health-check enqueueing). |

`apps/worker` additionally REQUIRES `SUPABASE_SERVICE_ROLE_KEY` even in
non-production environments (`loadWorkerConfig()` throws
`ConfigurationError` without it) — there is no way to claim or update
`operational_jobs` rows without it, so a misconfigured worker fails to
start rather than silently idling.

`loadServerConfig()` itself still fails closed in production
(`APP_ENV=production`) when `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, or
`SESSION_SIGNING_SECRET` is missing, or when `DEV_AUTH_MODE=enabled` —
re-verified in Section 12 Part B with no change needed.

## Deployment order (first deploy / clean environment)

1. Provision the Supabase project (or equivalent managed Postgres +
   PostgREST + Auth stack).
2. Apply every migration in `supabase/migrations/` **in filename
   order** (they are timestamp-prefixed and must not be reordered or
   skipped). Verified in Section 12 Part G: the full chain applies
   clean against a fresh database with zero errors (`tests/database/run.sh`
   itself resets and rebuilds the schema from migrations plus local-only
   Supabase role/auth.uid() stubs before every test run).
3. Set every `REQUIRED`/`SECRET` environment variable for the target
   environment (see `docs/environment-variables.md`) — never reuse
   staging Telegram bot tokens or destinations in production.
4. Deploy every Edge Function under `supabase/functions/`.
5. Deploy `apps/bot` in webhook mode and register the webhook via
   Telegram's `setWebhook` with the matching `secret_token`.
6. Deploy `apps/worker` — at least one replica; more are safe (see
   table above). Confirm its startup log line ("Worker started") shows
   the expected `pollIntervalMs`/`schedulerTickMs`.
7. Deploy `apps/mini-app`'s static build behind HTTPS, with
   `VITE_API_BASE_URL` pointed at the deployed Edge Functions.
8. Run the production smoke-test checklist (`docs/OPERATIONS_RUNBOOK.md`)
   before directing real user traffic at the deployment.

## Concurrency proof (worker replicas)

Re-run in Section 12 as a REAL (not simulated) multi-connection
Postgres test — `tests/database/concurrency_test.sh`:

- 10 concurrent `psql` connections racing to claim the same QUEUED job:
  exactly 1 won, 9 saw `empty`. (~4.8s wall time including the full
  migration+RLS suite that precedes it in `run.sh`.)
- 50 concurrent connections, same race: exactly 1 won, 49 saw `empty`.
  (~0.8s wall time, standalone.)

This is the structural guarantee that makes running more than one
`apps/worker` replica safe — no application-level locking is needed or
assumed.

## Graceful shutdown

`apps/worker` handles `SIGTERM`/`SIGINT` by: stopping the scheduler
interval, interrupting any idle poll wait immediately (rather than
blocking out the rest of `WORKER_POLL_INTERVAL_MS`), letting any
in-flight job handler finish, then exiting. Verified by
`apps/worker/src/worker-runner.test.ts` (5 tests), including a timing
assertion that shutdown does not wait out a full poll interval.

## Rollback strategy

**Never blindly reverse (`DOWN`) a migration against a database that
already has real data** — a `DOWN` migration can silently discard rows
a `UP` migration added columns/constraints for. The correct rollback
path:

1. **Application rollback** (bad `apps/bot`/`apps/worker`/Edge
   Function deploy, schema unchanged): redeploy the prior container
   image/build artifact. Nothing in the database needs to change.
2. **Schema rollback genuinely needed** (a migration itself is wrong):
   write a new, forward-only migration that corrects the issue (e.g.
   drop a bad constraint, backfill a column) — never edit or delete an
   already-applied migration file, and never run a hand-written
   `DROP`/`ALTER` outside a tracked migration.
3. **A migration partially applied and failed**: Postgres migrations in
   this repository run inside the transaction Supabase's migration
   runner itself provides — a failed migration does not leave partial
   DDL behind; fix the migration file and reapply.

## Build reproducibility

`npm ci` (not `npm install`) against the committed `package-lock.json`
in a clean checkout, followed by `npm run build`, is the only
supported production build path — verified clean in Section 12 Part AK
with zero drift between the lockfile and `package.json` across every
workspace.

## What this document does not claim

No infrastructure (Supabase project, hosting account, DNS, TLS
certificate, CI/CD pipeline) has actually been provisioned by this
work. "Deployable" above means: the code, migrations, and
configuration contract are complete and verified locally against a
real Postgres instance and a real multi-connection concurrency test —
not that a production environment has been stood up, load-tested at
scale, or operated. See `docs/PRODUCTION_READINESS.md` for the explicit
IMPLEMENTED/TESTED/DEPLOYED/CONFIGURED/LIVE/VERIFIED breakdown.
