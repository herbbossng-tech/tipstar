# Data Quality Engine (Section 04)

`packages/football-engine/src/quality-engine.ts`. Never reduces data
quality to one unexplained number — every check produces a structured
`DataQualityCheckResult`, and every call produces a `DataQualityResult`
(`quality-types.ts`) with a `status`, a `score` (checks-passed /
checks-run, a summary alongside the checks, never a replacement for
reading them), and the full `checks[]`/`warnings[]`/`errors[]` arrays.

## Status states

```
VALID                — every check passed
VALID_WITH_WARNINGS  — every error-severity check passed; at least one warning-severity check did not
INVALID              — at least one error-severity check failed
QUARANTINED          — assigned by the caller (ingestion.ts), not the engine itself, when it decides
                        to quarantine an INVALID record rather than reject it outright
```

`quality-engine.ts`'s functions only ever return `VALID` /
`VALID_WITH_WARNINGS` / `INVALID` — `QUARANTINED` is an ingestion-layer
decision, kept separate so the engine stays a pure "what's wrong with
this record" function or your reader would not be able to tell "the
engine detected a problem" apart from "the pipeline decided what to do
about it".

## The 15 named checks

Spanning every category the spec requires (completeness, validity,
consistency, freshness, temporal integrity, uniqueness, source
reliability), reused across entity types where the same question
applies to more than one:

| # | Check | Category | Severity | Applies to |
|---|---|---|---|---|
| 1 | `required_fields_present` | Completeness | error | fixture, match result, match event, odds |
| 2 | `team_references_present` | Completeness | error | fixture |
| 3 | `valid_timestamp` | Validity | error | fixture, match result, match event, odds |
| 4 | `distinct_teams` | Consistency | error | fixture |
| 5 | `non_negative_goals` | Validity | error | match result (defense in depth vs. the DB `CHECK` constraint) |
| 6 | `halftime_not_exceeding_fulltime` | Consistency | warning | match result |
| 7 | `positive_odds` | Validity | error | odds (defense in depth vs. the DB `CHECK` constraint) |
| 8 | `observed_at_not_in_future` | Temporal integrity | error | match result, match event, odds |
| 9 | `published_at_not_after_observed_at` | Freshness | warning | odds |
| 10 | `observed_after_kickoff` | Temporal integrity | warning | match result, match event (only when the fixture is known) |
| 11 | `event_type_recognized` | Consistency | error | match event |
| 12 | `event_minute_within_bounds` | Validity | warning | match event (0–130) |
| 13 | `observation_not_stale` | Freshness | warning | match result, odds (5-year default threshold) |
| 14 | `no_duplicate_provider_record_in_batch` | Uniqueness | warning | any batch, via `checkBatchUniqueness()` |
| 15 | `temporal_reliability_acceptable` | Source reliability | warning | odds (warns on `"estimated"`, i.e. no provider-published timestamp) |

Every entity-level check re-verifies something the corresponding
normalizer (`normalize.ts`/`adapters/*.ts`) already validated — this is
deliberate defense in depth, the same reasoning `LeakageGuard` applies
to its own re-checks (see `LEAKAGE_PROTECTION.md`): a future normalizer
bug must still be caught here, before a bad record reaches a
repository.

**Why error vs. warning is assigned the way it is:** a check is
error-severity only when the record would otherwise violate a database
`CHECK`/`UNIQUE` constraint or a structural invariant the rest of the
system assumes holds (distinct teams, non-negative goals, positive
odds, a recognized event type, a parseable timestamp, no data claiming
to originate from the future). Everything else — halftime/fulltime
sanity, freshness, kickoff ordering, estimated-vs-confirmed odds
reliability, in-batch duplicates — is a signal worth recording but not
worth rejecting a record over, since none of those violate a hard
invariant and idempotent upsert already makes an in-batch duplicate
safe regardless.

## Batch-level uniqueness

`checkBatchUniqueness(records, keyFn, entityLabel)` is the one
batch-scoped (rather than per-record) check — run once per ingested
array, it flags (warning-severity, non-blocking) any provider-record-id
that appears more than once in the same batch. It exists for
observability, not to block ingestion: `FixturesRepository.upsert()`
already makes a duplicate safe (see `FOOTBALL_DATA_ARCHITECTURE.md`'s
"Upsert rules"). Deliberately **not** applied to odds observations —
multiple odds observations sharing a fixture/market/selection are
expected and required to all be preserved, not a duplicate.

## Quarantine

`data_quarantine` (`repositories/quality.ts`'s `QuarantineRepository`).
Every record `ingestion.ts` rejects — whether at normalization or at
the quality-check stage — is quarantined with its `provider`,
`providerRecordId` (when known), `entityType`, a human-readable
`reason`, the full raw payload, and the `ingestionRunId` it was
rejected during. Nothing is ever silently discarded; a rejected record
is always queryable by `listForRun(ingestionRunId)`.

Only `service_role`/admin roles can read `data_quarantine` (see
`FOOTBALL_DATA_ARCHITECTURE.md`'s "RLS" section) — it may contain raw
provider payloads not intended for general `authenticated` access.

## Data conflicts (multi-provider disagreement)

`packages/football-engine/src/conflicts.ts`'s
`detectAndRecordConflict(conflicts, comparison)` compares one field's
value as reported by two providers for the same real-world entity and
records a `DataConflict` (`data_conflicts` table) when they genuinely
disagree — never silently picking one value, and never inventing a
reliability ranking between providers. A field only one side has
reported is explicitly **not** treated as a conflict (that's incomplete
coverage, not disagreement) — see `conflicts.test.ts`.

**Only one provider (`test_fixture_provider`) is connected this
section**, so nothing in the ingestion pipeline can genuinely trigger
this yet. The function exists and is directly tested so a second
provider's ingestion can call it — e.g. after upserting a team from
provider B, comparing its name against the same team as already known
from provider A — without redesigning the conflict model when that day
comes.

## See also

- [`FOOTBALL_DATA_ARCHITECTURE.md`](./FOOTBALL_DATA_ARCHITECTURE.md)
- [`LEAKAGE_PROTECTION.md`](./LEAKAGE_PROTECTION.md)
- `packages/football-engine/src/quality-engine.test.ts` (all 15 checks exercised)
