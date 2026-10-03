# Weekly Reporting (Section 11 Parts J-O, AA, AB)

## Purpose

Section 06 already built a `WeeklyReportAgent` as an orchestration
boundary. Section 11 builds the real reporting SERVICE that agent
consumes — it does not build a second reporting agent, and it does not
recompute anything Section 08 already computes.

## Data source: `performance_ledger` only

`generateWeeklyReport()` (`packages/agents/src/weekly-report-service.ts`)
reads exclusively from `performance_ledger` via the narrow
`PerformanceLedgerReader` interface — **never raw `settlements` rows
directly**. `performance_ledger` is documented, in its own Section 08
migration comment, as "the cache/snapshot of a recomputable rollup" —
the correct, designated read surface for reporting. Until Section 11's
own `PerformanceSnapshotJobHandler` ran, nothing had ever written to
this table (the same gap `OPEN_QUESTIONS.md` #25 flagged for the
sibling tickets/execution tables) — closing the read+write gap for
`performance_ledger` specifically is this section's first prerequisite.

`PerformanceSnapshotJobHandler`'s bounded scope: it queries real
`settlements`/`tickets`/`settlement_legs`, groups by
`(ledgerMode, ticketType)` only, hardcodes `sport: "football"` (the only
sport ever persisted), and leaves `league`/`market`/`modelVersion`/
`decisionPolicyVersion` unbroken-out (`undefined`, meaning "not broken
out by this axis," never "unknown") — resolving those would require
joining through `ticket_legs`/`decisions`/`value_evaluations`, deferred
to a later, honest expansion (see `OPEN_QUESTIONS.md`'s new entry).

## The `WeeklyReport` model

Every metric preserves its NULL semantics and sample size — a NULL
financial metric (e.g. ROI with zero stake) is never converted to zero,
and every breakdown row carries its own `sampleSize` so a tiny sample is
never mistaken for a strong result. PAPER and LIVE are always reported
separately: `computeFinancialTotals()` wraps every arithmetic call
(`addMoney`/`computeNetPnl`/`computeRoi`, Section 08, unchanged) in a
try/catch and returns `undefined` — never silently combining — if a
breakdown spans multiple currencies.

**CLV (Closing-Line Value) is permanently `undefined`** in every report:
no CLV column exists on `performance_ledger`, and the pure
`computeClosingLineValue()` function (Section 08) needs decision +
closing-odds data that isn't stored at the aggregate level. This is
never fabricated.

A report also carries: ticket counts (settled/won/lost/void/push/
pending), actual stake/payout, net P&L, ROI, max drawdown, longest
losing streak, market/league/model/policy breakdowns (as far as
`performance_ledger` itself breaks them out — see above), a Telegram
publication summary (`summarizeTelegramPublications()`), and a
`reportVersion`/`generatedAt`/`reportingPeriod`/`ledgerMode` stamp.

## Generation, idempotency, and versioning (Parts M, AB)

`generateWeeklyReport(deps, input)`:

1. Checks the deterministic idempotency key
   (`weekly-report:{periodStart}:{periodEnd}:{ledgerMode}`) first — a
   repeat, non-regeneration request for an already-generated period
   returns the existing report rather than creating a duplicate.
2. A defensive second check (`findCurrentForPeriod`) catches the edge
   case where a caller's own idempotency-key computation differs from
   what's on file but a real prior version still exists — refuses with
   `WEEKLY_REPORT_ALREADY_EXISTS` rather than ever calling `create()`
   (proven by `SECTION11 ADVERSARIAL N`, whose fake store's `create()`
   throws if reached — the test shows it's never reached).
3. A genuine regeneration (`regenerateReason` provided) creates a **new**
   row: `reportVersion` incremented, `supersedesReportId` pointing at the
   prior row, `supersededReason` recorded. **The prior row is never
   touched.**

`weekly_reports` is insert-only by construction: no `update()` method
exists on the repository, and no `authenticated`-role write policy
exists on the table either — the same "insert-only by construction"
pattern Section 08 already established for `settlements`. A UNIQUE
index on `(period_start, period_end, ledger_mode, report_version)` is
the versioning boundary at the database layer.

## Telegram publication (Part N)

`TelegramReportPublicationJobHandler` constructs a real `AgentMessage`
COMMAND (`CommandType.REQUEST_PUBLICATION`) and dispatches it via
`AgentOrchestrator.dispatch()` with the existing
`TELEGRAM_CHANNEL_AGENT_DECLARATION`/`TelegramChannelManagementAgent` —
**never a direct Telegram API call from the reporting engine.** The flow
is: Weekly Report → Publication Policy → Telegram Channel Management
Agent → existing Telegram publication service → Telegram Bot API,
exactly Section 10's established pipeline. If publication fails, report
generation remains successful — the publication job fails
independently, and publication failure never alters the report's own
contents. Retry of a publication failure only happens if the failure is
classified safe (`classifyDispatchFailure()`), and reuses Section 10's
own `telegram_publications` idempotency contract — Section 11 adds no
second one.

## Storage (Part O)

`weekly_reports` stores `sourceReference` (references into the
`performance_ledger` rows a report was built from — e.g. row ids) and
`reportPayload` (the normalized `WeeklyReport` itself), never a full
duplicate of the underlying settlement/performance dataset.

## Scheduling (Part AC)

A `WEEKLY_REPORT_GENERATION` job is the unit of scheduled execution —
typed, persisted, and idempotent by construction (its own deterministic
key). No platform-default timezone is assumed anywhere in the generation
logic itself: `periodStart`/`periodEnd` are supplied as explicit ISO
timestamps by whatever enqueues the job (today, the `admin-reports` Edge
Function's POST handler), never derived from an implicit "today" in an
unstated timezone.
