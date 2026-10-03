# Mini App Data Contracts (Section 09)

Five new Supabase Edge Functions, all read-only, all following the exact
pattern `me`/`telegram-auth` established in Section 02/03: Deno runtime,
service-role Supabase client, `supabase/functions/_shared/auth.ts` for
session + entitlement verification, a typed JSON error envelope
(`{error: {code, message}}`).

## `GET /football-fixtures`

**Entitlement:** `football_analysis`.
**Params:** `date` (`YYYY-MM-DD`, defaults to today UTC), `competitionId`
(optional).

Queries `fixtures` for the UTC day, joins `competitions`/`teams` (two
flat batched queries, not a PostgREST embed — see "Why flat queries"
below), and reports `hasMarketData`/`hasIntelligence` as real existence
checks against `market_observations`/`value_evaluations` (never
inferred). Computes nothing — no probability, no market list.

## `GET /football-fixture-detail?fixtureId=`

**Entitlement:** `football_analysis`.

Returns the fixture, its latest real result (if any, from
`match_results`, ordered `result_recorded_at DESC, version_seq DESC` —
the same point-in-time-safe ordering `SupabaseMatchResultsRepository.
getLatest()` uses), and the **latest** `value_evaluations` row per
`(market_type, selection, line)` — deduplicated server-side
(`latestPerMarket()`), each joined to its finalized `decisions` row when
one exists. Every figure (probability, market odds, fair odds, edge, EV)
is copied verbatim from the stored row; this endpoint computes none of
them.

## `GET /tickets?status=`

**Entitlement:** `football_tickets`.

One row per ticket (never expanded per leg — §16/§17). For each ticket:
real `legCount` (via a single batched `ticket_legs` query, grouped in
application code), `executionStatus` (`NOT_EXECUTED` when no
`execution_requests` row exists at all — a Mini-App-only state, never
confused with a real `ExecutionResultStatus`; otherwise the latest
`execution_results.status` for that ticket's latest request), and
`settlementStatus` (`NOT_SETTLED` when no `settlements` row exists —
distinct from the real `PENDING` settlement state — otherwise the
**effective** status after folding any `settlement_revisions` via
`resolveEffectiveSettlement()`, a Deno-side mirror of `@sport-os/
settlement-engine`'s `resolveCurrentSettlement()`).

## `GET /ticket-detail?ticketId=`

**Entitlement:** `football_tickets`.

Full detail: the ticket row, its `ticket_legs`, every `decisions`/
`risk_evaluations` row referencing it, every `execution_requests` row
with its own `execution_results` history, and — if settled — the
`settlements` row with its `settlement_legs` and full,
chronologically-ordered `settlement_revisions` chain (so the UI can show
"this settlement was revised N times, original outcome X" per §28,
without hiding history).

## `GET /performance-summary?ledgerMode=&sport=&league=&market=&modelVersion=&decisionPolicyVersion=&ticketType=&periodStart=&periodEnd=`

**Entitlement:** `advanced_analytics`.

Filters `performance_ledger` by its own real, stored dimension columns
and returns the rows **verbatim** — no aggregation happens in this
endpoint or in the Mini App. `ledgerMode` defaults to `LIVE`; a caller
must explicitly pass `PAPER` to see backtest/paper performance, so the
two are never accidentally combined in the default view (§22/§27).

No odds-bucket or EV/edge-bucket filter is offered — `performance_ledger`
has no such column (Section 08 never built that dimension), so
offering the filter here would imply a capability that doesn't exist.
See `OPEN_QUESTIONS.md`.

## Why flat queries, not PostgREST embeds

Every endpoint uses separate `.select()` calls plus in-application-code
joins (via `Map`s keyed by id) rather than PostgREST's embedded-resource
syntax (`teams!fixtures_home_team_id_fkey(...)`). This repo's test
infrastructure validates schema/RLS against raw PostgreSQL via `psql`
(`tests/database/run.sh`) — there is no running Supabase/PostgREST
instance in this environment to verify embed-hint syntax against. Flat
queries are unambiguous, don't depend on PostgREST's foreign-key-hint
resolution, and are easy to reason about; the tradeoff is more round
trips per request, acceptable at this endpoint's real scale (a day's
fixtures, one ticket's legs, etc. — tens of rows, not thousands).

## Reused view-model types, not reused packages

`apps/mini-app/src/api/types.ts` defines its own TypeScript interfaces
for every response shape, rather than importing `@sport-os/football-
engine`/`@sport-os/settlement-engine` types directly — mirroring the
precedent `auth/types.ts` already set for `@sport-os/telegram` (those
packages are server-side TypeScript with no browser-bundling guarantee).
Every enum's string VALUES are kept byte-identical to their backend
source (documented in a comment on each type), so there is no "subtly
incompatible duplicate enum" (§45) — a `SettlementStatus` of `"WON"` in
`api/types.ts` means exactly the same thing as `@sport-os/settlement-
engine`'s `SettlementStatus.WON`.

## What was not built

- **Ticket creation.** Tickets are the platform's own published
  intelligence output (`tickets.created_by` references the system
  actor that created them, not a viewing user) — this Mini App is a
  consumption/monitoring surface, not a bet-slip builder. No create-
  ticket endpoint was built.
- **Execution confirmation.** No `execution_requests`/
  `execution_results` repository exists yet to back a write endpoint —
  see `MINI_APP_SECURITY.md`'s "What was not built."
- **Aviator data.** No Aviator signal/round/Double Bet persistence
  exists anywhere in this codebase (`aviator-engine`'s `signal-
  engine.ts`/`double-bet.ts` and `GlobalDailyRiskController` are real,
  pure computation with no backing database table). `AviatorPage`
  renders an honest "Aviator unavailable" state rather than inventing a
  signals table — see `OPEN_QUESTIONS.md`.
- **Competition-list endpoint.** `football-fixtures` accepts a
  `competitionId` filter, but no endpoint lists available competitions
  to populate a dropdown with — the Football screen offers only the
  date selector for now.

## See also

- [`MINI_APP_ARCHITECTURE.md`](./MINI_APP_ARCHITECTURE.md)
- [`MINI_APP_SECURITY.md`](./MINI_APP_SECURITY.md)
- [`SETTLEMENT_ARCHITECTURE.md`](./SETTLEMENT_ARCHITECTURE.md) — the
  settlement/revision model `ticket-detail`/`tickets` reads from.
- [`PERFORMANCE_ARCHITECTURE.md`](./PERFORMANCE_ARCHITECTURE.md) — the
  `performance_ledger` shape `performance-summary` reads from.
