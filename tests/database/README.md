# Database / RLS tests (Section 03)

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
  an audit log row.
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
- `run.sh` — applies the stubs, every migration in
  `supabase/migrations/`, the fixtures, and the test suite, in order,
  against a scratch database.

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
