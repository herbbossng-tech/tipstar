# Football Provider Integration (Section 13)

Section 13 connects two **real** external data providers to the
provider-agnostic boundary Section 04 already built
(`FOOTBALL_DATA_ARCHITECTURE.md`'s RAW INGEST → NORMALIZATION → DATA
QUALITY → TIME-AWARE DATA STORE pipeline). It is **data ingestion only**:
no bookmaker execution, no SportyBet automation, no model
retraining/retuning, no Value Engine or Mini App redesign. Everything
below terminates at the existing Section 04 adapter/normalization
boundary — the rest of the system (features, models, decision, risk,
execution) consumes canonical internal contracts only, unchanged.

## LOCKED provider decision

- **Sportmonks** — canonical football-data provider (competitions,
  seasons, teams, fixtures, fixture status, results, match events).
- **The Odds API** — canonical odds provider (bookmaker odds, pre-match
  and historical snapshots, point-in-time retrieval).

Neither provider is given a role the other owns: Sportmonks has no
`odds` facet wired up (no deliberate reason exists to add one beyond The
Odds API), and The Odds API is never treated as a fixture/result/event
source.

## Provider responsibilities

| Concern | Owner |
|---|---|
| Competitions / seasons / teams | Sportmonks |
| Fixtures / fixture status | Sportmonks |
| Match results (final score) | Sportmonks (derived from its own `scores` include — no separate "results" endpoint exists) |
| Match events (goals, cards, substitutions, VAR) | Sportmonks |
| Bookmaker odds (live and historical) | The Odds API |
| Standings / team stats / lineups / xG | **Not ingested this pass** — Sportmonks may support some of these, but no canonical contract/consumer exists yet; adding them is future work, not fabricated here. |
| Player-level data | **Not ingested** — `FootballPlayerProvider` is intentionally unimplemented (see `provider.ts`'s own doc comment: "avoid premature player-level complexity"). |

## Architecture — where this plugs in

```
Sportmonks API ──> adapters/sportmonks-provider.ts ──┐
                                                       ├──> ingestion.ts (ingestReferenceData / ingestFixtures / ingestMatchResults / ingestMatchEvents — ALL UNCHANGED)
The Odds API   ──> adapters/odds-api-provider.ts ────┘       │
                          │                                   ├──> DataQualityEngine (UNCHANGED) ──> QUARANTINE | CANONICAL WRITE
                          └─ identity reconciliation ──────────┘
                             (apps/worker job, writes fixture_external_identities)
```

Both adapters are plain TypeScript modules in
`packages/football-engine/src/adapters/` — `sportmonks-provider.ts` and
`odds-api-provider.ts`. Neither adapter is exposed outside its own file
except through the Section 04 `RawRecord`/canonical `Normalized*` shapes
— no Sportmonks or Odds API SDK type ever appears in `ingestion.ts`, the
repositories, or anywhere above this boundary.

## Configuration

No new public env-var *names* were invented for credentials —
`packages/config/src/schema.ts` already had the full
`FOOTBALL_DATA_*`/`ODDS_*` scaffold since Section 01, unused until now
(see `FOOTBALL_DATA_ARCHITECTURE.md`'s old "Providers actually
connected" section). This section wires real adapters behind that
existing scaffold and adds exactly two new, narrow variables for league/
sport-key *selection* (never credentials):

| Variable | Meaning | Server-only? |
|---|---|---|
| `FOOTBALL_DATA_PROVIDER` / `FOOTBALL_DATA_API_KEY` | Sportmonks provider name / API key | API key: yes |
| `FOOTBALL_DATA_ENABLED` | `true`/`false` — defaults `false`. Ingestion jobs no-op when `false`, at both the scheduler (never enqueued) and handler (never fetches) layers. | no |
| `FOOTBALL_DATA_BASE_URL` / `FOOTBALL_DATA_TIMEOUT_MS` / `FOOTBALL_DATA_MAX_RETRIES` / `FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE` / `FOOTBALL_DATA_POLL_INTERVAL_SECONDS` | Standard `ProviderConfig` tuning | no |
| **`FOOTBALL_DATA_COMPETITION_IDS`** (new) | Comma-separated Sportmonks league ids. **Unset = nothing selected = ingestion safely no-ops.** Never a hard-coded permanent league list in code. | no |
| `ODDS_PROVIDER` / `ODDS_API_KEY` | The Odds API provider name / API key | API key: yes |
| `ODDS_ENABLED` | Same semantics as `FOOTBALL_DATA_ENABLED`. | no |
| `ODDS_BASE_URL` / `ODDS_TIMEOUT_MS` / `ODDS_MAX_RETRIES` / `ODDS_RATE_LIMIT_PER_MINUTE` / `ODDS_POLL_INTERVAL_SECONDS` | Standard tuning | no |
| **`ODDS_SPORT_KEYS`** (new) | Comma-separated Odds API sport keys (e.g. `soccer_epl,soccer_spain_la_liga`). **Unset = nothing selected = ingestion safely no-ops.** | no |

`apiKey` fields are in `SERVER_ONLY_ENV_KEYS` (`packages/config/src/schema.ts`)
— never read by `loadClientConfig()`, never present in anything the Mini
App bundle or browser can reach. `packages/config/src/load.ts`'s
`parseCommaSeparatedIds()` turns the two new comma-separated variables
into `readonly string[]` on `AppConfig.providers.football.selectedIds` /
`.odds.selectedIds`.

**Activation model**: both providers start disabled
(`FOOTBALL_DATA_ENABLED=false`/`ODDS_ENABLED=false` are the schema
defaults). Flipping either to `true` without also setting its
`*_API_KEY` and `*_COMPETITION_IDS`/`ODDS_SPORT_KEYS` still safely
no-ops (the adapter returns `unavailable`/the job handler returns
`{ ok: true }` immediately) — there is no code path that "ingests
everything" by default. Nothing in this codebase auto-flips either flag
to `true`.

## Data provenance

Every normalized observation preserves, exactly as Section 04 already
required: `provider`, `providerObservationId` (odds) /
`providerFixtureId`/`providerEventId` (fixtures/events), `observedAt`,
`providerPublishedAt`, `temporalReliability`, `ingestionRunId`. Neither
adapter ever fabricates a timestamp its provider didn't supply — see
"Known limitations" below for the specific, narrow cases where a
timestamp is instead OUR OWN ingestion-time observation, always
documented as such in code and never presented as provider-supplied.

## Point-in-time odds semantics — READ THIS BEFORE QUERYING HISTORICAL ODDS

> **Sportmonks historical odds are not our permanent historical odds
> archive. The Odds API is the canonical historical odds source.**

> **The Odds API historical endpoint returns the closest snapshot equal
> to or earlier than the requested timestamp.**

`fetchOddsApiHistoricalOdds()` (`adapters/odds-api-provider.ts`) reads
the historical endpoint's own response envelope — `{ timestamp,
previous_timestamp, next_timestamp, data }` — and uses `timestamp` (the
ACTUAL snapshot time the provider returned) as every flattened record's
`snapshot_timestamp`, which `normalizeOddsApiOdds()` then uses as
`observedAt`. The REQUESTED `date` query parameter is **never** written
into a normalized observation — relabeling the returned (closest-
earlier) snapshot as exactly equal to the requested time would silently
corrupt `LeakageGuard`'s point-in-time guarantees. A response missing
its own `timestamp` field is treated as `unavailable`, never defaulted
to the requested time.

`listForFixtureAsOf(fixtureId, asOf)`
(`repositories/observations.ts`) already implements exactly the
required "observedAt <= asOf, ascending" semantic unchanged —
`packages/football-engine/src/section-13-point-in-time-odds.test.ts` is
the literal regression test proving the spec's own example: fixture
kickoff = T, snapshots at T-180m/T-120m/T-60m/T-10m/T+30m; a query at
T-90m sees only T-180m/T-120m; a query at T-5m sees T-180m/T-120m/T-60m/
T-10m (never the post-kickoff T+30m one); and ingestion time (when the
records were actually written) never overrides each snapshot's own
`observedAt` when resolving availability.

## Historical data limitations

- **Sportmonks** fixture/result/event history is ingested going
  forward from whenever ingestion is first enabled — this integration
  does not backfill arbitrary historical seasons. Reference data
  (competitions/seasons/teams) is scoped to each league's **current
  season only**; historical seasons are not ingested.
- **The Odds API** historical odds access depends on the account's own
  plan/quota with that provider — this document makes no claim about
  how far back historical snapshots are available or what they cost;
  that is a commercial fact about the account, not something this code
  can assert.

## Rate limits & provider health

Both adapters classify failures into exactly the outcomes `provider.ts`
already defines:

- HTTP 429 → `rate_limited` (with `Retry-After` when the provider sends
  one) — never retried internally by the adapter; the job system's own
  bounded retry (via `isRetryableJobFailure`/`computeNextAttemptDelayMs`)
  handles it.
- HTTP 5xx → thrown, so `withBoundedRetries()` retries a bounded number
  of times (`*_MAX_RETRIES`), never unbounded.
- HTTP 4xx (other than 429) → `unavailable` — never retried (retrying a
  bad credential/request cannot succeed).
- A malformed/unexpected response body → `unavailable`, never guessed
  into a fabricated success.

Neither adapter logs an API key under any circumstance — `apiKey` is
only ever read from `ProviderConfig`/`config.providers.*` and placed
into the outgoing request URL, never into a log line, error message, or
quarantine `rawPayload`.

An empty result set (a provider genuinely returning zero records) is
always treated as "zero records this call," never as a reason to delete
existing canonical data — no destructive synchronization exists
anywhere in this integration.

## Ingestion jobs & scheduling

Three new `operational_job_type` values (migration
`20261005200000_football_provider_job_types.sql`), using the EXISTING
Section 11/12 durable job infrastructure (`operational_jobs`,
`claim_next_operational_job()`'s `FOR UPDATE SKIP LOCKED`, bounded
retry/backoff) — no second job system, no second worker process:

| Job type | Handler | What it does |
|---|---|---|
| `FOOTBALL_REFERENCE_INGESTION` | `FootballReferenceIngestionJobHandler` | Sportmonks competitions/seasons/teams for the configured leagues → `ingestReferenceData` (unchanged). |
| `FOOTBALL_FIXTURE_INGESTION` | `FootballFixtureIngestionJobHandler` | One Sportmonks fixture payload per league (fetched with `include=participants;state;scores;events.type`) feeds `ingestFixtures` + `ingestMatchResults` + `ingestMatchEvents` (all three unchanged) — one fetch, three writes, never three fetches. |
| `FOOTBALL_ODDS_INGESTION` | `FootballOddsIngestionJobHandler` | The Odds API live odds for the configured sport keys → identity reconciliation (below) → `ingestOddsObservations` (unchanged, extended only via the new optional `fixtureIdentityResolver` parameter). |

All three handlers live in `packages/agents/src/jobs/football/` and are
constructed with already-built `IngestionDependencies` (dependency
injection, not a raw Supabase client) — `apps/worker/src/container.ts`
is the one place that builds the real Supabase-backed repositories and
wires them in, exactly like every other job handler in this codebase.

**Scheduling** (`apps/worker/src/scheduler.ts`): each provider's
schedule config (`enabled`, `pollIntervalSeconds`, `hasSelection`) gates
whether its jobs are ever enqueued at all — disabled, no poll interval,
or no competitions/sport keys selected all mean "never enqueued," not
just "handler no-ops." The bucket size is `pollIntervalSeconds`,
matching the existing health-check bucket pattern exactly — two ticks
within the same configured interval converge on one durable job row,
never a duplicate. Nothing in this codebase hard-codes an aggressive
polling interval; an unset `*_POLL_INTERVAL_SECONDS` means "never
enqueued," not "poll as fast as possible."

A fixed, conservative `FIXTURE_LOOKAHEAD_DAYS = 3` (fixture job) bounds
how far ahead each individual Sportmonks fixtures fetch looks — not
configurable this pass (no operational need has yet justified adding a
dedicated env var for it).

## Fixture identity reconciliation

Sportmonks and The Odds API identify the same real-world fixture with
**unrelated** ids (`public.fixtures`' `unique(provider,
provider_fixture_id)` is keyed to Sportmonks alone). A second provider's
id is never assumed to equal a Sportmonks id, and fixtures are never
merged on name/time similarity alone without an explicit, auditable
record of that decision:

1. `fixture_external_identities` (migration
   `20261005200100_fixture_external_identities.sql`) is the explicit
   cross-reference table — `(provider, provider_fixture_id)` unique,
   `fixture_id` FK, `match_method` (currently always
   `"team_name_kickoff_time"`), admin-read-only RLS, service-role write
   only.
2. `FootballOddsIngestionJobHandler` groups each fetch's flat odds
   records by Odds API event id. For each event not already mapped, it
   calls `FixturesRepository.listByKickoffWindow(commence_time ±30min)`
   (a new, narrow repository method added specifically for this —
   deliberately NOT reused for any leakage-sensitive read) to get
   CANDIDATE Sportmonks fixtures, then compares each candidate's own
   home/away team names (normalized: lowercased, trimmed, "fc"/"cf"
   suffix dropped) against the Odds API event's `home_team`/`away_team`.
3. **Exactly one** matching candidate → `recordMapping()` writes the
   confirmed mapping (idempotent: a repeat call for an already-mapped
   provider identity returns the existing mapping unchanged, never
   overwrites it).
4. **Zero** or **more than one** matching candidate → quarantined
   (`public.data_quarantine`, `entityType: "odds_observation"`) with a
   precise reason (`"No candidate Sportmonks fixture matched..."` /
   `"Ambiguous match: N candidate Sportmonks fixtures matched..."`) —
   **never guessed**. That event's odds are excluded from this run's
   `ingestOddsObservations` call entirely (avoiding a second, less
   precise quarantine entry from `ingestOddsObservations`'s own generic
   "fixture not found" path).
5. `ingestion.ts`'s `ingestOddsObservations` gained one new, optional,
   backward-compatible parameter: `fixtureIdentityResolver?:
   FixtureIdentityResolver`. When a fixture doesn't resolve via the
   existing `getByProviderIdentity(provider, providerFixtureId)` lookup,
   it falls back to `resolver.resolve(provider, providerFixtureId)` —
   `FixtureExternalIdentitiesRepository.resolve()` implements this
   interface structurally (a pure lookup against already-confirmed
   mappings, never a guess). Every existing call site that omits this
   parameter behaves identically to before — proven by running the full
   existing `ingestion.test.ts` suite unchanged and green.

**Known limitation**: team-name matching is approximate (provider
naming conventions differ — e.g. "Arsenal" vs "Arsenal FC"). This is
exactly why ambiguous/zero-match cases are quarantined rather than
forced — the system is honest about reconciliation failures instead of
silently merging the wrong fixtures.

## Market mapping

`ODDS_API_MARKET_MAP` (`adapters/odds-api-provider.ts`) is the one
explicit, auditable mapping table from The Odds API's own market keys to
this codebase's canonical `MarketType` enum (`@sport-os/market-engine`),
confirmed via live research against The Odds API's documentation (not
guessed):

| Odds API `market_key` | Canonical `MarketType` | Selection convention |
|---|---|---|
| `h2h` | `MATCH_RESULT_1X2` | `"home"` / `"away"` / `"draw"` |
| `totals` | `OVER_UNDER` | `"over_<line>"` / `"under_<line>"` (e.g. `"over_2.5"`) |
| `btts` | `BOTH_TEAMS_TO_SCORE` | `"yes"` / `"no"` |

**Deliberately NOT mapped this pass** — real Odds API market keys this
integration does not yet claim support for: `spreads` (handicap, mainly
a US-market convention), `double_chance`, `draw_no_bet`. Any market key
outside the table above is rejected at normalization time
(`ODDS_API_UNSUPPORTED_MARKET`) and quarantined — never silently
mis-mapped onto a similarly-named canonical market. Extending this table
is a future, explicit decision, not something this integration does
implicitly.

Bookmaker identity (`bookmaker_key`, e.g. `"pinnacle"`) is preserved
verbatim on every normalized odds observation — no bookmaker is ever
hard-coded as "the" canonical source, and nothing here prevents the
intelligence layer from comparing multiple bookmakers' prices for the
same fixture/market/selection.

## Known limitations (MOST IMPORTANT RULE compliance)

Section 13's own rule: *"Do not invent provider API behavior. If
Sportmonks or The Odds API documentation does not support a required
field/endpoint/semantic, stop at the adapter boundary and report the
limitation rather than fabricating an implementation."*
`docs.sportmonks.com` was unreachable from this development environment
(network egress blocked) during this work — the shapes below were
corroborated only via third-party search results and general
familiarity with Sportmonks API v3, **not** independently re-verified
against live/current documentation. Every normalizer is written
defensively: an unrecognized or unverified shape is **rejected**
(quarantined), never guessed.

- **Match status**: only `state.short_name` values `NS`/`1st`/`HT`/
  `BRK`/`FT` are mapped with any real confidence. Extra-time/penalties,
  postponed, cancelled, abandoned, suspended, interrupted, delayed,
  awarded, walkover — and notably **2nd-half-live** fixtures (only the
  1st-half short name could be corroborated) — all normalize to
  `MatchStatus.UNKNOWN` rather than being guessed.
- **Match results**: derived from the fixture's own `scores` include,
  reading only `description === "CURRENT"` entries. Half-time goal
  counts are never populated (no verified description value exists for
  them) — always `undefined`, never guessed.
- **`resultRecordedAt`**: Sportmonks supplies no result-specific
  timestamp distinct from the fixture itself, so this is OUR OWN
  ingestion-time observation — the same convention this codebase already
  established for fixture status transitions without a provider
  timestamp (`repositories/fixtures.ts`'s `NewFixtureInput.observedAt`
  doc comment). Never presented as a Sportmonks-supplied value.
- **Match events**: classified from `type.name` by case-insensitive
  keyword match (goal / own goal / penalty / yellow / red / substitution
  / var), not from a verified numeric `type_id` table. An unrecognized
  or missing type name is rejected, never guessed.
- **`NormalizedCompetition.active`**: Sportmonks' league resource has no
  independently verified "is this league active" boolean; defaults to
  `true` rather than fabricating a `false` the provider never sent.
- **Team fetching** depends on Sportmonks' `currentSeason.teams` nested
  include; if a league/plan combination doesn't support it, `fetchTeams`
  returns `unavailable` rather than guessing at an alternate endpoint.
- **The Odds API market coverage**: see "Market mapping" above —
  `spreads`/`double_chance`/`draw_no_bet` are explicitly out of scope,
  not silently unsupported.

## Failure & recovery procedures

- A provider outage (`unavailable`/thrown transport error exceeding
  retries) makes the relevant job report a retryable
  `INTEGRATION_UNAVAILABLE` failure — the job system's own
  `isRetryableJobFailure`/exponential backoff handles retrying it,
  bounded by the job's `maxAttempts`. It never appears falsely healthy —
  `OperationalHealthCheckJobHandler` already reads
  `footballDataProviderConfigured`/`oddsProviderConfigured` from real
  config, not a hope.
- A per-record quality/normalization failure (bad shape, unsupported
  market, unresolved fixture identity) is quarantined and does **not**
  fail the job — ingestion continues for every other record in the same
  batch.
- A single league's Sportmonks fetch failure
  (`FOOTBALL_FIXTURE_INGESTION`) does not abort other leagues in the
  same job run — leagues that already succeeded keep their committed
  ingestion; the job as a whole still reports failure so the next
  attempt retries the failed league(s).
- No destructive synchronization exists anywhere: a provider returning
  fewer records than before is never interpreted as "delete the rest."

## Commercial / licensing assumptions

This document makes **no claim** about either provider's actual
commercial terms, rate limits, or historical-data retention beyond what
each provider's own documentation states at the time an operator
configures real credentials — those are facts about the operator's own
account/contract with Sportmonks and The Odds API respectively, not
something this code can assert or guarantee. Before activating either
provider in production, the operator should independently confirm their
own plan's rate limits, included markets/regions, and historical data
depth directly with that provider.

## Production activation checklist

1. Obtain a Sportmonks API key and/or The Odds API key under the
   operator's own account/plan.
2. Set `FOOTBALL_DATA_API_KEY`/`ODDS_API_KEY` (server-side secrets —
   never commit them, never place them in any client-reachable config).
3. Set `FOOTBALL_DATA_COMPETITION_IDS` (Sportmonks league ids) and/or
   `ODDS_SPORT_KEYS` (Odds API sport keys) to the specific competitions
   to ingest — there is no default list.
4. Set `FOOTBALL_DATA_ENABLED=true` and/or `ODDS_ENABLED=true`.
5. Set a sane `FOOTBALL_DATA_POLL_INTERVAL_SECONDS`/
   `ODDS_POLL_INTERVAL_SECONDS` matching the operator's own plan's rate
   limits — this document does not recommend a specific value, since
   that depends entirely on the operator's own provider plan.
6. Deploy the updated `apps/worker` — the scheduler will begin enqueuing
   `FOOTBALL_REFERENCE_INGESTION`/`FOOTBALL_FIXTURE_INGESTION`/
   `FOOTBALL_ODDS_INGESTION` jobs on the next tick.
7. Optionally run the manual, read-only smoke test (`npm run
   smoke-test:football-providers --workspace=apps/worker`, requires
   `FOOTBALL_PROVIDER_SMOKE_TEST_CONFIRM` plus real credentials) to
   independently verify connectivity before relying on the scheduled
   jobs.
8. Monitor `OPERATIONAL_HEALTH_CHECK` output and `public.data_quarantine`
   for reconciliation/quality issues after the first few runs.

## What this integration explicitly did NOT touch

Bookmaker execution, SportyBet automation/scraping, CAPTCHA/anti-bot
bypass, automatic betting, Aviator, Double Bet,
`GlobalDailyRiskController`, Telegram publishing architecture (only its
existing operational-health reporting reads the new `enabled` flags —
already true before this section), auto-publishing of newly ingested
fixtures, auto-generated tickets, any existing model (Elo/Form/H2H/
Poisson/Dixon-Coles/RF/GBT/NN/Monte Carlo/Ensemble/Calibration/
Probability Consistency/Value Engine), the Value Engine's own
calculations, Section 05 feature calculations, or the Mini App's UI —
once ingestion is activated, the existing Football screen naturally
moves from "0 fixtures today" to real data through the response
contract it already has, with no UI changes required.
