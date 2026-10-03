# Section 11 — Automation Operations, Licensing Administration & Reporting

## Purpose

Section 11 is an **operations control plane**, not a new domain engine.
It gives OWNER/ADMIN users real, backend-enforced visibility and control
over licensing, scheduled/background work, and weekly reporting — reusing
every prediction/decision/value/risk/settlement/execution/Telegram-
publishing authority already built in Sections 01-10, never duplicating
or weakening any of it.

## What Section 11 is

| Area | What's real |
|---|---|
| License administration | `renewLicense`/`reactivateLicense`/`listUsersForAdmin`/`inspectUserForAdmin` (`packages/platform/src/operations/license-admin.ts`) |
| Authorization matrix | Read-only `canPerform()` documentation of who may do what (`operations/authorization-matrix.ts`) |
| Platform settings | A read-only, secret-free snapshot (`operations/platform-settings-admin.ts`) |
| Operational health | A pure `evaluateOperationalHealth()` over caller-supplied probe results (`operations/operational-health.ts`) |
| Durable jobs | A Postgres-backed queue + atomic claim + worker (`operations/jobs.ts`, `packages/agents/src/jobs/*`) |
| Weekly reporting | `generateWeeklyReport()` over the real `performance_ledger` (`packages/agents/src/weekly-report-service.ts`) |
| Agent operations | Read-only invocation counts over the existing agent framework (`operations/agent-operations.ts`) |
| Admin surfaces | 3 Edge Functions, 3 Mini App screens, 4 bot commands |

## What Section 11 is NOT

- Not a second football/Aviator intelligence, value, market, risk, or
  settlement engine. No new prediction model, no new feature, no new
  value/EV formula exists anywhere in this section's code.
- Not a second Telegram publishing pipeline. `TelegramReportPublicationJobHandler`
  constructs a real `AgentMessage` COMMAND and calls
  `AgentOrchestrator.dispatch()` against the existing
  `TELEGRAM_CHANNEL_AGENT_DECLARATION`/`TelegramChannelManagementAgent` —
  it never calls the Telegram Bot API directly.
- Not a second license/entitlement authorization system. Every mutation
  in `license-admin.ts` still goes through Section 03's locked state
  machine, roles, and entitlement keys.
- Not a distributed job queue / generic cron platform. `operational_jobs`
  is one Postgres table with an atomic `FOR UPDATE SKIP LOCKED` claim
  function — a "simple, reliable job runner," per the spec's own words.
- Not a bookmaker/payment integration of any kind.

## Why the Mini App's existing `/me`-style read model wasn't enough

Sections 03/06/08/10 built real admin-capable write functions
(`suspendLicense`, `createDestination`, …) but no composed admin READ
views (a list of users with their license/usage in one call) and no way
to run background work durably. Section 11 adds exactly those two
missing things — composed reads, and a durable job abstraction — rather
than rebuilding anything that already worked.

## Reused vs. new, at a glance

**Reused, unchanged:** `GlobalExecutionGate`, `AgentOrchestrator`,
`PublishingAuthorizer`, `TelegramChannelManagementAgent`,
`buildPerformanceLedgerEntry()`, Section 03's license state machine and
roles, Section 08's `performance_ledger` schema, Section 10's
`telegram_publications` idempotency.

**New:** `operational_jobs`/`weekly_reports` tables, `OperationalJobWorker`
and its four handlers, `renewLicense`/`reactivateLicense`/admin read
views, the authorization matrix, the platform settings snapshot, the
pure health evaluator, three Edge Functions, three Mini App screens,
four bot commands.

## Known, honestly-documented limitations

1. **No standalone deployed process runs `OperationalJobWorker.runOnce()`
   on a schedule.** The worker and all four handlers are real, unit- and
   integration-tested, and ready to be invoked by a scheduled process —
   but Section 11 does not add a new deployable app/cron binary for this.
   See `JOBS_AND_SCHEDULING.md` and `OPEN_QUESTIONS.md`.
2. **`PerformanceSnapshotJobHandler` only breaks out `(ledgerMode,
   ticketType)`**, not league/market/model/policy — see
   `WEEKLY_REPORTING.md`.
3. **The admin Mini App ships Home/Jobs/Reports only** — not the full
   Licenses/Users/Agents/Audit/System screens the spec describes. Every
   backend capability those would need (`listUsersForAdmin`,
   `inspectUserForAdmin`, `getAgentOperationsSummary`,
   `evaluateOperationalHealth`) is real and tested; only their admin UI
   screens are not yet built.
4. **`OPERATIONAL_HEALTH_CHECK`'s `SETTLEMENT_SUBSYSTEM` probe is always
   `UNKNOWN`** — no dedicated settlements-connectivity check is wired;
   see `OPEN_QUESTIONS.md`.

See also: [`LICENSE_ADMINISTRATION.md`](./LICENSE_ADMINISTRATION.md),
[`JOBS_AND_SCHEDULING.md`](./JOBS_AND_SCHEDULING.md),
[`WEEKLY_REPORTING.md`](./WEEKLY_REPORTING.md),
[`OPERATIONS_SECURITY.md`](./OPERATIONS_SECURITY.md).
