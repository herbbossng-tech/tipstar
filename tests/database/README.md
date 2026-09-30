# Database / RLS tests (Section 03 users/licenses; Section 04 football data; Section 05 intelligence metadata; Section 06 agent framework; Section 07 decision/value/ticket/risk/execution)

These validate `supabase/migrations/` directly against a real PostgreSQL
server — no Supabase CLI, Docker, or PostgREST required. This is
deliberate: RLS enforcement is a Postgres-level property, testable
rigorously via raw SQL without the HTTP layer as a confound.

## What's here

- `00_supabase_stubs.sql` — **local test harness only, never applied to a
  real Supabase project.** Recreates the `anon`/`authenticated`/
  `service_role` Postgres roles and `auth.uid()` (reading the `sub` claim
  from a `request.jwt.claims` session setting) — a faithful reproduction
  of Supabase's own [documented, open-source implementation](https://github.com/supabase/auth),
  not invented behavior. A real Supabase project provides all of this
  natively; this file exists purely so the migrations can be validated
  against a plain, locally-installed Postgres instance.
- `10_fixtures.sql` — test users (owners, admins, plain users, a
  suspended user), licenses (active, expired), entitlements, limits, and
  an audit log row. Also `77777777-7777-7777-7777-777777777777`, a user
  reserved EXCLUSIVELY for `20_rls_cases.sql`'s TEST 23d — see that
  file's comment above TEST 23 and "A fixture-isolation pitfall" below.
- `20_rls_cases.sql` — the test suite itself: every one of the Section 03
  spec's 22 required RLS test cases (plus role-bounded positive cases and
  a few DB-integrity bonus checks), each run in its own
  `BEGIN ... ROLLBACK` transaction so nothing persists and one test's
  expected permission error never aborts the rest. Tests 23a–23e (added
  as a PR review fix) are the exception: they exercise
  `claim_owner_bootstrap()`, the atomic one-time OWNER bootstrap claim, so
  23c–23e deliberately `COMMIT` to verify real before/after state across
  transactions — see the comment block above TEST 23 for why true
  concurrent-transaction testing isn't reproducible in this serial psql
  harness, and how the row-locking argument extends the serial checks
  into a structural concurrency guarantee.
- `30_football_fixtures.sql` — Section 04 test data: a competition,
  season, two teams, a scheduled fixture, an ingestion run, and one odds
  observation — clearly synthetic (`test_fixture_provider`), never mixed
  with production data.
- `40_football_rls_cases.sql` — football data RLS cases: authenticated
  read access, the full "no client mutation" surface (fixtures, results,
  odds), admin-only operational tables (`ingestion_runs`), and DB-level
  integrity constraints (distinct teams, no duplicate provider fixture,
  no negative goals, no non-positive odds, multiple odds observations
  preserved). FB TESTs 15–21 (added as a PR review fix) cover
  `fixture_status_observations` RLS and the two point-in-time correctness
  fixes at the real schema level: a fixture's status resolves correctly
  by `asOf` across scheduled/live/finished transitions (never a future
  status in an earlier snapshot), and `match_results` allows — and
  correctly resolves by `asOf` — multiple append-only versions per
  fixture (never a correction leaking through an earlier snapshot). FB
  TESTs 22–27 (added as a further PR review hardening fix) cover the
  `upsert_fixture_with_status_observation` atomic RPC: EXECUTE lockdown,
  the fixture-plus-observation write succeeding as one coherent
  operation, a failed observation write rolling back the fixture write
  too (TEST 24, following the same commit-then-fresh-transaction pattern
  as `20_rls_cases.sql`'s TEST 23c), `version_seq` resolving two
  same-timestamp match-result versions deterministically, a repeat
  sighting never rewriting fixture identity fields, and an unchanged
  repeat sighting recording no redundant observation row.
- `50_intelligence_fixtures.sql` — Section 05 test data: one row each
  in `intelligence_dataset_versions`/`intelligence_model_versions`/
  `intelligence_calibration_versions`/`intelligence_ensemble_versions`/
  `intelligence_evaluation_runs`/`intelligence_training_runs` — clearly
  synthetic version strings (`*-test-v1`), never mixed with production
  data.
- `60_intelligence_rls_cases.sql` — intelligence metadata RLS cases:
  admin-only read access on every table (never broad `authenticated`,
  unlike Section 04's content tables — these are internal ML-pipeline
  artifacts), the full "no client mutation" surface, service-role write
  access (the real training/evaluation path), and DB-level integrity
  constraints (unique model_family+model_version, unique
  ensemble_version, walk-forward window chronology on training runs,
  non-inverted calibration training ranges).
- `70_agent_fixtures.sql` — Section 06 test data: one
  `agent_invocations` row (a completed Football Intelligence Agent
  invocation), one `agent_messages` row (the command that triggered it),
  and one `agent_idempotency_claims` row — clearly synthetic ids, never
  mixed with production data. No test here performs a real `COMMIT` (see
  "A fixture-isolation pitfall" below for why that matters), so none of
  these fixtures are at risk of the incident that section describes.
- `80_agent_rls_cases.sql` — agent framework RLS cases: admin-only read
  access on `agent_invocations`/`agent_messages` (never broad
  `authenticated`, matching Section 05's internal-artifact pattern),
  `agent_idempotency_claims` withheld even from admins (service-role
  only — it carries no content worth browsing, only concurrency-control
  state), the full "no client mutation" surface, service-role write
  access (the real orchestrator path), and DB-level integrity
  constraints: the `(agent_type, idempotency_key)` unique index on
  `agent_invocations` (and confirmation that the SAME key is allowed
  again under a DIFFERENT `agent_type`, proving the scoping is real), the
  CHECK constraint tying `failure_code`/`failure_disposition` presence
  exactly to `status = 'failed'`, and `agent_idempotency_claims`' own
  primary-key uniqueness.
- `90_section07_fixtures.sql` — Section 07 test data: one full
  decision/value/ticket/risk/execution pipeline instance atop the
  existing `f1000000-...-0001` football fixture and Alice
  (`11111111-...-1111`) — a `market_observations` snapshot, a `BET`
  `value_evaluations` row, a `DRAFT` ticket with its `ticket_status_history`
  row and one `ticket_legs` row, an approved `risk_evaluations` row, a
  `decisions` row tying the value/risk evaluations together, an
  `execution_requests` row (denied at the gate — `gate_authorized=false`,
  since no permitted integration exists), and its `NOT_AVAILABLE`
  `execution_results` row — clearly synthetic ids, never mixed with
  production data.
- `100_section07_rls_cases.sql` — decision/value/ticket/risk/execution RLS
  cases: admin-only read access on every table (matching Section 06's
  internal-engine-output pattern — none of this is exposed through a Mini
  App UI yet), the full "no client mutation" surface (not even an admin
  may write directly), service-role write access (the real repository
  path), and DB-level integrity constraints: the real UNIQUE constraint
  enforcing `tickets.idempotency_key` and `execution_requests.
  idempotency_key` (including proving the latter is global, not scoped
  per-ticket — a retried key collides even across a different
  `ticket_or_signal_id`), non-positive stake/odds rejections, an
  out-of-range probability rejection on both `value_evaluations` and
  `ticket_legs`, an invalid `execution_results.status` enum value
  rejection, and `ticket_status_history`'s own `(ticket_id, version)`
  uniqueness (append-only versioning — a repeated version is rejected, a
  genuinely new version is accepted).
- `run.sh` — applies the stubs, every migration in
  `supabase/migrations/`, all five fixture sets, and all five test
  suites, in order, against a scratch database.

## Running

```bash
./tests/database/run.sh
```

This is **not** part of `npm test` — it needs a running local PostgreSQL
server (`sudo service postgresql start`) reachable as the `postgres`
superuser, which CI/sandboxed environments may not always provide. The
output is a transcript, not a pass/fail exit code: each `\echo` line
states what the following SQL result is expected to show (a row count, an
error, or a specific value) — read the result immediately beneath it and
confirm it matches. This mirrors exactly how this suite was validated
when Section 03 was built (see the PR description for the full
transcript).

Cases 16–19 (license validity / entitlement-enabled semantics) are
deliberately not RLS tests — they're pure application logic
(`isLicenseActive()`/`hasEntitlement()` in `@sport-os/platform`), covered
instead by that package's own Vitest unit tests, consistent with the
spec's own split between "RLS TESTING" and "LICENSE TESTS".

## A fixture-isolation pitfall (and the fix)

`run.sh` applies both fixture sets and both test suites to ONE scratch
database in ONE continuous session — nearly every test wraps its
mutation in `BEGIN ... ROLLBACK`, so in practice each test runs against
the same starting state regardless of file order. `20_rls_cases.sql`'s
TEST 23d is the one deliberate exception: it `COMMIT`s for real, because
proving the one-time owner-bootstrap claim is durable *across separate
transactions* requires an actual commit, not a rollback (TEST 23e's
"a later attempt fails" check depends on TEST 23d's promotion having
genuinely stuck).

This was found to matter: TEST 23d originally targeted Alice
(`11111111-1111-1111-1111-111111111111`), permanently promoting her to
`'owner'` for the rest of that `run.sh` invocation. `40_football_rls_cases.sql`
runs afterward against the SAME database, and its FB TEST 7
("authenticated non-admin cannot read `ingestion_runs`") also uses
Alice — expecting her to still be a plain `'user'`. She wasn't, so
`is_admin()` correctly returned `true` and the test observed 1 row
instead of the expected 0.

Investigating this confirmed `public.is_admin()`, the
`request.jwt.claims`/`auth.uid()` handling in `00_supabase_stubs.sql`,
and the `ingestion_runs_select_admin_only` RLS policy were all working
exactly as intended — Alice genuinely *was* an owner by the time FB TEST
7 ran; the policy correctly reported that. The bug was fixture
isolation, not RLS: a test that must commit for real was reusing a
fixture user that other tests, in another file entirely, assumed would
keep its original role for the whole run.

**Fix:** TEST 23d now targets `77777777-7777-7777-7777-777777777777`, a
user added to `10_fixtures.sql` and reserved exclusively for this
purpose — no other test may target it or assume its role. If you add a
new test that needs a real `COMMIT` (not a `ROLLBACK`), give it its own
dedicated fixture row the same way, rather than reusing one of the
shared "plain user"/"admin"/"owner" fixtures every rollback-based test
relies on keeping its seeded role for the whole `run.sh` invocation.
