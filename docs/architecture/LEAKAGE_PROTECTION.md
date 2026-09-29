# Leakage Protection (Section 04)

This document is Section 04's concrete implementation of the rule
Section 01 locked in
[`../data/DATA_LEAKAGE_PRINCIPLE.md`](../data/DATA_LEAKAGE_PRINCIPLE.md):
*"Every future football feature must represent information that was
genuinely available before kickoff."* That document stays the
architectural principle; this one is how Section 04 actually enforces
it at the data layer, before any feature exists to leak into.

## The core rule

```
observation.observedAt <= snapshotTime
```

...and the observation must represent information genuinely available
at that time — never post-hoc knowledge presented as if it existed
earlier. A feature snapshot for a fixture at 18:00, ahead of a 19:00
kickoff, may use historical results, prior odds, prior team form — but
must never use the final score, post-match statistics, or any
observation whose `observedAt` is after 18:00, no matter how it was
requested.

## Named leakage types

`packages/football-engine/src/leakage-guard.ts`'s `LeakageType` const —
the 9 categories the spec names, each a possible `AppError.code` an
internal-invariant violation is tagged with:

```
FUTURE_RESULT_LEAKAGE    FUTURE_ODDS_LEAKAGE      FUTURE_EVENT_LEAKAGE
FUTURE_LINEUP_LEAKAGE    FUTURE_INJURY_LEAKAGE    FUTURE_STANDING_LEAKAGE
FUTURE_FEATURE_LEAKAGE   TARGET_LEAKAGE           DATASET_SPLIT_LEAKAGE
```

`FUTURE_LINEUP_LEAKAGE`/`FUTURE_INJURY_LEAKAGE`/`FUTURE_FEATURE_LEAKAGE`/
`TARGET_LEAKAGE`/`DATASET_SPLIT_LEAKAGE` are declared for completeness
(no `Lineup`/`PlayerAvailability` entity or feature/training pipeline
exists yet to violate them against — those are Section 05's domain).
`FUTURE_RESULT_LEAKAGE`/`FUTURE_ODDS_LEAKAGE`/`FUTURE_EVENT_LEAKAGE`/
`FUTURE_STANDING_LEAKAGE` are actively enforced today by `getDataAsOf()`
below, against real data this section stores.

## The point-in-time query contract

**"Give me the football data available as of SNAPSHOT_TIME for
FIXTURE_ID."** This is the one function Section 05 is told to depend
on:

```ts
getDataAsOf(deps: LeakageGuardDependencies, fixtureId: UUID, snapshotTime: ISODateString): Promise<Result<FixtureSnapshot, AppError>>
```

`FixtureSnapshot` — every field already filtered to `<= snapshotTime`
before the type is ever constructed:

```ts
{
  fixtureId, snapshotTime, fixture,
  matchResult: MatchResult | undefined,       // undefined if not yet known OR recorded after snapshotTime — indistinguishable, correctly so
  events: readonly MatchEvent[],
  homeTeamObservations: readonly TeamObservation[],
  awayTeamObservations: readonly TeamObservation[],
  oddsObservations: readonly OddsObservation[],
}
```

### Defense in depth

Every repository this function calls exposes a point-in-time-safe
`*AsOf(id, asOf)` method — `repositories/fixtures.ts`'s
`listForFixtureAsOf` (match events), `getByIdAsOf` (fixture identity +
status), `getAsOf` (match results), and `repositories/observations.ts`'s
`listForTeamAsOf`/`listForFixtureAsOf` (team/odds observations) — that
filters `observedAt <= asOf` (or the equivalent field) at the query
layer — server-side (`.lte(...)`) for the Supabase implementations,
in-memory for tests. `getDataAsOf()` does not stop at trusting that
filter: for match events, team observations, and odds observations, it
**independently re-verifies every single record it gets back** against
`snapshotTime`, and returns a structured `InternalError` tagged with
the matching `LeakageType` code if a repository ever returns something
it should not have. This makes leakage protection structurally hard to
violate by accident — a future bug in one repository's `*AsOf`
implementation is caught here, not three layers downstream in a
trained model. The match result gets the same re-verification
(`FUTURE_RESULT_LEAKAGE` if `getAsOf` ever returns a version whose
`resultRecordedAt` is actually after `snapshotTime`); the fixture
itself does not need a symmetric re-check — `getByIdAsOf` either
returns a fixture whose status fields it resolved from an observation
already known `<= asOf` (structurally impossible to be future-dated),
or `undefined`, which `getDataAsOf` treats as "not found."

The match result is handled slightly differently: a result version that
exists but has a `resultRecordedAt` after `snapshotTime` is not an
error, it is correctly excluded — `getAsOf` simply won't return it, so
`matchResult` is `undefined` either way, exactly as it should be, since
Section 05 must never be able to tell "no result yet" apart from
"result exists but isn't available to you."

### Pre-match snapshot boundary

```ts
computePreMatchSnapshotTime(fixture: Fixture, leadTimeMinutes: number): ISODateString
```

`leadTimeMinutes` is a required parameter with no default — the spec is
explicit that the caller must supply it, since the architecture does
not specify one universal lead time. This function never hard-codes
one.

## The permanent leakage regression test

`packages/football-engine/src/leakage-guard.test.ts`, describe block
**"LeakageGuard — permanent leakage regression test"**. Exact scenario
from the Master Blueprint — do not weaken, remove, or "simplify" this
test; if a future change breaks it, the change is wrong, not the test:

```
Kickoff:        2026-01-10T19:00:00Z
Snapshot time:  2026-01-10T18:00:00Z

Available   (observedAt <= snapshot): 17:00, 17:30, 17:45
Unavailable (observedAt >  snapshot): 18:15, 21:00
```

Team observations and odds observations are seeded at all five
timestamps; the test asserts `getDataAsOf()` returns **exactly** the
three available ones in each collection and **none** of the two
unavailable ones — by explicit id/timestamp membership, not just a
count. A companion test seeds a `MatchResult` recorded at 20:55 (after
the kickoff, well after the snapshot) and asserts it is excluded from
the 18:00 snapshot and correctly included once the snapshot is taken
at or after 21:00.

## The adversarial future-information test

`describe("LeakageGuard — adversarial future information test")` in the
same file. Three tests each construct a **deliberately buggy**
repository — one whose `listForFixtureAsOf`/`listForTeamAsOf` ignores
`asOf` entirely and returns a record dated after the snapshot,
simulating a future implementation bug — and assert `getDataAsOf()`
still catches it and returns the matching `LeakageType` error
(`FUTURE_ODDS_LEAKAGE`, `FUTURE_STANDING_LEAKAGE`,
`FUTURE_EVENT_LEAKAGE` respectively). This is what proves the defense-in-depth
re-verification described above is real, not merely present as
dead code — a query-layer bug is caught at the `LeakageGuard` boundary,
not silently passed through.

## Match Result Correction Leakage / Mutable Fixture Status Leakage (PR review fixes)

Two merge-blocking point-in-time bugs were found in review and fixed:

- **Match Result Correction Leakage**: `match_results` used to be one
  mutable row per fixture; a provider correction UPDATEd it while
  *preserving* the original `resultRecordedAt`, so a historical query
  using that timestamp could see the corrected score. Fixed by making
  `match_results` append-only VERSIONS — `MatchResultsRepository.
  insert()` never mutates a prior row, and `getAsOf(fixtureId, asOf)`
  resolves to the version with the greatest `resultRecordedAt <= asOf`.
- **Mutable Fixture Status Leakage**: `getDataAsOf()` read the fixture
  via `getById()`, which returns CURRENT (mutable) status — a pre-match
  snapshot could see a status (e.g. `finished`) the fixture had not yet
  reached. Fixed with `fixture_status_observations`, an append-only
  history table, and `FixturesRepository.getByIdAsOf(id, asOf)`, which
  `getDataAsOf()` now calls instead of `getById()`.

See `FOOTBALL_DATA_ARCHITECTURE.md`'s "Point-in-time correctness fixes"
for the full design rationale. Regression coverage exists at every
layer:

- `repositories/repositories.test.ts` — `InMemoryMatchResultsRepository`'s
  `getAsOf`/`getLatest` and `InMemoryFixturesRepository`'s
  `getByIdAsOf`/`getById`, each with the required a/b/c/d cases (pre-
  correction/transition snapshot, post-correction/transition snapshot,
  the correction/transition never altering an earlier snapshot, multiple
  corrections/transitions resolving correctly by `asOf`).
- `leakage-guard.test.ts` — two new `describe` blocks, **"LeakageGuard —
  Match Result Correction Leakage regression"** and **"LeakageGuard —
  Mutable Fixture Status Leakage regression"**, exercising the exact
  scenarios above end-to-end through `getDataAsOf()` itself, not just
  the repository layer.
- `tests/database/40_football_rls_cases.sql` FB TESTs 15–21 — the same
  two scenarios against the real Postgres schema (not just the in-memory
  test double), plus RLS coverage for the new
  `fixture_status_observations` table.

A further review round hardened both fixes: the fixture upsert and its
status observation are now one atomic Postgres function call (never two
round-trips that could commit independently), match-result versions
sharing the exact same `resultRecordedAt` resolve deterministically via
a `version_seq` tiebreaker, and a fixture's identity fields
(competition/season/home/away team) are immutable, with a repeat
sighting reporting a different identity quarantined rather than
silently applied. See `FOOTBALL_DATA_ARCHITECTURE.md`'s "Hardening
pass" section and `tests/database/40_football_rls_cases.sql` FB TESTs
22–27.

## What this does *not* do

- It does not build any feature from this data — no rolling windows,
  form, xG, Elo, or model training exist in this codebase. That is
  Section 05's explicit responsibility.
- It does not implement `DATASET_SPLIT_LEAKAGE`/`TARGET_LEAKAGE`
  detection — those apply to a training pipeline that does not exist
  yet; the `LeakageType` codes are reserved for when it does.
- `getDataAsOf()` is read-only and has no caching — every call re-queries
  the underlying repositories. No cache/TTL/invalidation policy was
  needed this section (see `FOOTBALL_DATA_ARCHITECTURE.md`; caching is
  explicitly "only if needed").

## See also

- [`../data/DATA_LEAKAGE_PRINCIPLE.md`](../data/DATA_LEAKAGE_PRINCIPLE.md) (Section 01 — unchanged)
- [`FOOTBALL_DATA_ARCHITECTURE.md`](./FOOTBALL_DATA_ARCHITECTURE.md)
- [`DATA_QUALITY.md`](./DATA_QUALITY.md)
- `packages/football-engine/src/leakage-guard.ts` / `leakage-guard.test.ts`
