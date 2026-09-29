# Football Data Architecture (Section 04)

Section 04 owns the trustworthy football data boundary: FOOTBALL DATA
SOURCES → PROVIDER ADAPTER → RAW INGEST → NORMALIZATION → DATA
VALIDATION → QUALITY ENGINE → TIME-AWARE DATA STORE → FEATURE SNAPSHOT
INPUT. Section 05 (feature engineering, models, ensemble, calibration,
decision) consumes this foundation through one narrow, point-in-time-safe
contract (`getDataAsOf` — see `LEAKAGE_PROTECTION.md`) and does not exist
yet. Nothing in this document implements a prediction model, a Sport
Agent decision, ticket generation, bookmaker execution, or SportyBet
automation — those remain untouched, per this section's locked rules.

## Providers actually connected

**None.** No football/odds provider credential exists anywhere in this
repository or its environment. `FOOTBALL_DATA_PROVIDER`/
`FOOTBALL_DATA_API_KEY`/`ODDS_PROVIDER`/`ODDS_API_KEY` remain unset
placeholders, exactly as Section 01 left them (now joined by
`FOOTBALL_DATA_ENABLED`/`FOOTBALL_DATA_BASE_URL`/
`FOOTBALL_DATA_TIMEOUT_MS`/`FOOTBALL_DATA_MAX_RETRIES`/
`FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE`/`FOOTBALL_DATA_POLL_INTERVAL_SECONDS`
and their `ODDS_*` equivalents — see `../environment-variables.md`).

The one concrete adapter this section ships,
`adapters/test-fixture-provider.ts`'s `testFixtureProvider`
(`provider: "test_fixture_provider"`), is **not** a real provider
integration. It is a deterministic, clearly-synthetic dataset (see
"The deterministic fixture dataset" below) that exercises the full raw →
normalized → quality-checked → stored pipeline exactly as a real
provider's adapter would, satisfying the spec's explicit instruction:
*"If no provider credential exists: implement the adapter contract and
deterministic test fixtures. Do not pretend a live provider is
connected."* Every row this adapter ever produces carries
`provider = "test_fixture_provider"`, trivially distinguishable from any
real provider's data by that column alone.

## Provider-agnostic architecture

`packages/football-engine/src/provider.ts` defines the adapter contract
no concrete provider is hard-coded against:

- `FootballFixtureProvider` / `FootballTeamProvider` /
  `FootballEventProvider` / `FootballOddsProvider` /
  `FootballPlayerProvider` — one interface per data category, each with a
  `fetchX(...)` method returning a `ProviderFetchOutcome<RawRecord>`
  (`"ok"` with records, `"unavailable"` with a reason, or
  `"rate_limited"` — never a fabricated empty success).
- `FootballDataProvider` — the umbrella a concrete adapter implements
  some or all facets of (`fixtures?`/`teams?`/`events?`/`odds?`/
  `players?`), since no provider is assumed to offer everything.
- `ProviderConfig` — `provider`/`enabled`/`baseUrl`/`apiKey`/`timeoutMs`/
  `maxRetries`/`rateLimitPerMinute`/`pollIntervalSeconds`. `apiKey` is
  never logged or exposed to the Mini App.
- `withBoundedRetries()` — retries only a thrown transport exception, up
  to `maxRetries` times with linear backoff; never infinite. A
  structured `"unavailable"`/`"rate_limited"` outcome is not retried
  here — the caller (ingestion) decides what to do with it.

`testFixtureProvider` currently wires only the `fixtures` facet (its
`fetchFixtures()` returns the raw fixture array). Reference data
(competitions/seasons/teams) and match results/events/odds are supplied
as plain raw-record arrays via `TEST_FIXTURE_PROVIDER_RAW_DATA` instead
of through a fetch call, because no live provider exists to call for
them yet — a real second provider would wire
`FootballEventProvider.fetchEvents({fixtureProviderId})` /
`FootballOddsProvider.fetchOdds({fixtureProviderId})` ahead of
`ingestMatchEvents()`/`ingestOddsObservations()` in `ingestion.ts`,
which already accept raw records in exactly that shape — no redesign
needed when a real provider arrives.

## Canonical football data model

`packages/football-engine/src/canonical.ts` — the only shapes
provider-specific code may produce (via normalization, never directly):
`DataSource`, `Competition`, `Season`, `Venue`, `Team`, `Fixture`,
`MatchResult`, `MatchEvent`, `TeamObservation`, `OddsObservation`,
`IngestionRun`. `Player`/`PlayerAvailability`/`Lineup` are **not**
implemented — no provider is connected that could reliably support them,
and the spec explicitly warns against premature player-level complexity
(see `OPEN_QUESTIONS.md`).

Every provider-scoped entity carries `provider` + a `providerXId` field
(`ProviderIdentity`) — **never assumed globally unique across
providers**; internal UUIDs are the only identifiers ever exposed
outside a single provider's own data. `normalizeCommonMatchStatus()`
maps a provider's raw status string to one of 10 canonical
`MatchStatus` values; an unrecognized code maps to `UNKNOWN`, never
guessed as something more specific than the evidence supports, and the
original string is preserved separately (`Fixture.providerStatusRaw`).

`UPCOMING_MATCH_STATUSES` / `LIVE_MATCH_STATUSES` /
`FINAL_MATCH_STATUSES` are the only sanctioned way to ask "is this
match over" — `FINAL_MATCH_STATUSES` contains exactly `FINISHED`. LIVE
is never treated as FINAL, and FINAL is never used in a pre-match
snapshot (`LeakageGuard` enforces the latter independently of status —
see `LEAKAGE_PROTECTION.md`).

`Fixture.scheduledKickoffAt` is set once and never overwritten by a
later sighting of the same fixture — a delay updates
`actualKickoffAt`, never this field (see `repositories/fixtures.ts`'s
`FixturesRepository.upsert()`, both the in-memory and Supabase
implementations, and `ingestion.test.ts`'s "preserves scheduledKickoffAt
across a second ingestion run" test).

## Migrations

12 new migrations, `supabase/migrations/20260929130000` through
`20260929131000` (including `130450`, added in review for the
point-in-time correctness fixes below), applied after Section 03's
(unchanged) schema:

| Migration | Adds |
|---|---|
| `130000_football_enums.sql` | `match_status`, `match_event_type`, `ingestion_status`, `ingestion_mode`, `data_conflict_status`, `temporal_reliability` |
| `130100_data_sources.sql` | `data_sources` — provider registry, not a hard FK dependency for other tables |
| `130150_ingestion_runs.sql` | `ingestion_runs` (created here, before the tables that FK to it — see the ordering note below) |
| `130200_competitions_seasons.sql` | `competitions`, `seasons` |
| `130300_venues_teams.sql` | `venues`, `teams` |
| `130400_fixtures.sql` | `fixtures` (`CHECK (home_team_id <> away_team_id)`, separate `scheduled_kickoff_at`/`actual_kickoff_at`), `match_results` — append-only result VERSIONS, no uniqueness constraint on `fixture_id` (`CHECK (home_goals >= 0)`, `CHECK (away_goals >= 0)`, `corrected_at`/`correction_count` per version) |
| `130450_fixture_status_observations.sql` | `fixture_status_observations` — append-only fixture status history (PR review fix; see "Point-in-time correctness fixes" below) |
| `130500_match_events.sql` | `match_events` — append-only, partial unique index on `(provider, provider_event_id)` where not null |
| `130600_team_observations.sql` | `team_observations` — flexible JSONB `metrics`, append-only |
| `130700_odds_observations.sql` | `odds_observations` — `CHECK (odds > 0)`, `temporal_reliability`, append-only |
| `130900_data_quarantine_conflicts.sql` | `data_quarantine`, `data_conflicts` |
| `131000_football_rls_policies.sql` | RLS policies for every table above |

`ingestion_runs` is deliberately migrated *before* `competitions`/
`fixtures` (out of otherwise-chronological order) because
`team_observations` and `odds_observations` reference
`ingestion_run_id` via foreign key — migration files apply in filename
sort order, so the referenced table must exist first.

All timestamps are `timestamptz`, stored as UTC, per the spec's
non-negotiable rule.

## Upsert rules — what's safely mutable vs. append-only

| Entity | Behavior |
|---|---|
| `data_sources`, `competitions`, `seasons`, `teams`, `venues` | Safely upserted by `(provider, providerXId)` — a provider correcting a team's name is expected and applied in place. |
| `fixtures` | Upserted by `(provider, provider_fixture_id)`; `scheduled_kickoff_at` is the one field set once and never touched again. Status/venue/`actual_kickoff_at` may change — this is the fast "current state" read (`getById`); every change is separately, immutably recorded in `fixture_status_observations` for point-in-time reads (`getByIdAsOf`) — see "Point-in-time correctness fixes" below. |
| `match_results` | **Append-only VERSIONS**, like `match_events`/`team_observations`/`odds_observations` below — `insert()`, no `update`. The first call for a fixture is the original; every later call is a correction, its own new row with its own `resultRecordedAt` (never inherited from a prior version). `getLatest()` is the "current state" read; `getAsOf()` is the point-in-time-safe read. See "Point-in-time correctness fixes" below. |
| `match_events`, `team_observations`, `odds_observations` | **Append-only.** No `update` method exists on any of their repositories. A correction is a new observation with a later `observedAt`, never a mutation. Multiple odds observations for the same fixture/market/selection are all preserved — never just the latest (`tests/database/40_football_rls_cases.sql`'s FB TEST 14, and `repositories.test.ts`). |

Idempotency throughout is keyed on `(provider, providerXId)`, never an
arbitrary UUID alone — re-ingesting the same raw record (including the
deliberately duplicated `TFP-FIX-1` record in the test fixture dataset)
updates the existing row, never creates a second one
(`ingestion.test.ts`'s "never creates two fixture rows..." test).

## Point-in-time correctness fixes (PR review)

Two point-in-time correctness bugs were found in review and fixed before
this PR merged — both are now covered by tests at every layer (in-memory
repository, `LeakageGuard`, and the real Postgres schema in
`tests/database/40_football_rls_cases.sql`).

**Match Result Correction Leakage.** The original design kept one
mutable `match_results` row per fixture; a correction UPDATEd it in
place while *preserving* the original `result_recorded_at`, so a
historical, point-in-time query using that timestamp would see the
*corrected* score through the *original* recording time. Fixed by
making `match_results` append-only VERSIONS (no `unique(fixture_id)`):
`MatchResultsRepository.insert()` always appends a new row with its own
`resultRecordedAt`, never mutating or reusing an earlier version's
timestamp; `getAsOf(fixtureId, asOf)` resolves to the version with the
greatest `resultRecordedAt <= asOf`, so a correction can only ever
become visible once ITS OWN timestamp has passed — never earlier, no
matter when it was actually inserted into the database.

**Mutable Fixture Status Leakage.** `fixtures.status`/
`provider_status_raw`/`actual_kickoff_at` are mutable "current state"
columns — correct for "what's happening now," but `LeakageGuard.
getDataAsOf()` was reading them via `FixturesRepository.getById()`,
which returns the fixture's CURRENT status regardless of the requested
`snapshotTime`. A pre-match snapshot could therefore see a status
(e.g. `finished`) the fixture had not yet reached at that snapshot
time. Fixed by adding `fixture_status_observations`, an append-only
history table mirroring `team_observations`/`odds_observations`:
`FixturesRepository.upsert()` records a new observation whenever
status/`providerStatusRaw`/`actualKickoffAt` actually changes (never on
an unchanged re-poll), and the new `getByIdAsOf(id, asOf)` reconstructs
the fixture with status fields taken from the latest observation known
`<= asOf` — identity fields (competition/season/teams/
`scheduledKickoffAt`/provider identity) are immutable and come through
unchanged. `LeakageGuard.getDataAsOf()` now calls `getByIdAsOf`
exclusively; `getById`/`getLatest` remain as explicit "current state,
NOT point-in-time-safe" reads for any other caller.

Neither fix touches Section 05 or later scope, weakens RLS, or changes
the service-role boundary — `fixture_status_observations` follows the
exact same RLS shape as every other content table (`SELECT` for
`authenticated`, no mutation grant, `ALL` for `service_role`).

## Ingestion pipeline

`packages/football-engine/src/ingestion.ts` is the one place raw
provider records become rows. Every exported function
(`ingestReferenceData`, `ingestFixtures`, `ingestMatchResults`,
`ingestMatchEvents`, `ingestOddsObservations`) follows the same shape:

1. Start an `IngestionRun` (`IngestionRunsRepository.start()`).
2. Fetch (for fixtures, through the provider abstraction with
   `withBoundedRetries`; for the others, from the raw records the
   caller supplies — see "Provider-agnostic architecture" above).
   A non-`"ok"` provider outcome fails the run outright — "provider
   unavailable" is never silently treated as "zero records".
3. Normalize each raw record via a caller-supplied normalizer function
   (`normalize.ts`'s `Normalized*` shapes) — a normalization failure
   quarantines the record and moves on, never throws and aborts the
   batch.
4. Run the matching `DataQualityEngine` check (see `DATA_QUALITY.md`) —
   an `INVALID` result quarantines the record.
5. Resolve every provider-scoped foreign reference (competition, team,
   season, fixture) to an internal UUID via the reference-data/fixture
   repositories — a missing dependency (e.g. a fixture referencing a
   competition that hasn't been ingested yet) quarantines the record
   rather than inserting a dangling reference.
6. Upsert/insert via the matching repository.
7. Update the `IngestionRun` with final counts
   (`recordsReceived`/`Inserted`/`Updated`/`Rejected`/`errorCount`) and
   status (`completed` if nothing was rejected, `partial` if some
   records were, `failed` if the fetch itself failed).

Every rejected record is quarantined with its reason and raw payload —
"never silently discard" — via `QuarantineRepository`. See
`ingestion.test.ts` for the full pipeline exercised end-to-end against
the deterministic dataset, including the duplicate and both invalid
fixture records.

## The deterministic fixture dataset

`adapters/test-fixture-provider.ts`'s `TEST_FIXTURE_PROVIDER_RAW_DATA`
covers every category the spec requires:

- 2 competitions, 2 seasons, 4 teams.
- 9 fixture records: 2 completed (`FT`), 2 upcoming (`NS`), 1 postponed
  (`PST`), 1 cancelled (`CANC`), 1 deliberate duplicate of an existing
  fixture (idempotency), 2 deliberately invalid (same home/away team;
  missing kickoff timestamp).
- 2 match results, 2 match events.
- 4 odds observations for one fixture: two pre-kickoff (17:00, 18:30),
  one pre-kickoff with no `published_at` (exercises `temporalReliability:
  "estimated"`), and one **post-kickoff** (19:30) — which must never
  enter a pre-kickoff snapshot (see `LEAKAGE_PROTECTION.md`).

Every value is a clearly synthetic placeholder ("Test Arsenal", "Test
Premier League", `TFP-*` ids) — never presented as, or capable of being
mistaken for, real historical football data.

## Repositories

`packages/football-engine/src/repositories/` — one interface + one
`InMemory*` + one `Supabase*` implementation per concern
(`reference-data.ts`, `fixtures.ts`, `observations.ts`,
`ingestion-runs.ts`, `quality.ts`, `data-sources.ts`), following the
same dual-implementation pattern Section 03 established for
`@sport-os/platform`. `MatchEventsRepository`/`TeamObservationsRepository`/
`OddsObservationsRepository`/`MatchResultsRepository`/`FixturesRepository`
each expose a point-in-time-safe read (`listForFixtureAsOf`/
`listForTeamAsOf`/`getAsOf`/`getByIdAsOf`, respectively) that
`LeakageGuard` and, later, Section 05's feature engineering build on.
See `LEAKAGE_PROTECTION.md` and "Point-in-time correctness fixes" above.

## Data access boundary

The Mini App never calls a football data provider directly — nothing in
`apps/mini-app` imports `@sport-os/football-engine`. The only path is
Mini App → backend (a future Edge Function/service, not built this
section — no Mini App-facing football endpoint exists yet) →
`@sport-os/football-engine`'s services/repositories → provider adapter
→ external provider. This mirrors the boundary Section 02/03 established
for identity/license data.

## RLS

`131000_football_rls_policies.sql` applies the same pattern Section 03
established: `revoke all` baseline, then explicit grants.

- **Content tables** (`competitions`, `seasons`, `venues`, `teams`,
  `fixtures`, `match_results`, `match_events`, `team_observations`,
  `odds_observations`, `fixture_status_observations`): `SELECT` granted
  to `authenticated` via
  `using (true)` — safe because these are non-sensitive platform
  reference/historical data, not user data, and no `authenticated`
  grant exists for `INSERT`/`UPDATE`/`DELETE` on any of them (verified:
  `tests/database/40_football_rls_cases.sql` FB TESTs 2–6).
- **Operational tables** (`data_sources`, `ingestion_runs`,
  `data_quarantine`, `data_conflicts`): `SELECT` restricted to
  `is_admin()` callers (FB TESTs 7–8).
- **`service_role`**: full grant on every table — the real ingestion
  write path (FB TEST 9).

No RLS policy anywhere in this section uses `USING (true)`/
`WITH CHECK (true)` for a write.

## See also

- [`DATA_QUALITY.md`](./DATA_QUALITY.md)
- [`LEAKAGE_PROTECTION.md`](./LEAKAGE_PROTECTION.md)
- [`../data/DATA_LEAKAGE_PRINCIPLE.md`](../data/DATA_LEAKAGE_PRINCIPLE.md) (Section 01, unchanged)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md)
- [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md)
- [`../environment-variables.md`](../environment-variables.md)
