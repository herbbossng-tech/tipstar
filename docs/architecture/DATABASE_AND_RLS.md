# Database & RLS (Section 03)

## Purpose

Section 01 established typed contracts (`IdentityService`, `LicenseService`,
`AuditService`) with `NotImplemented*` defaults — no database existed.
Section 03 adds the first real schema
(`supabase/migrations/`) and the first real persisted implementations,
under two non-negotiable rules the spec repeats throughout: **the
database enforces resource isolation** (RLS) and **the application
enforces business authorization** (`@sport-os/platform`'s admin
operations) — "neither layer should be treated as optional."

## Database model

Seven tables, all with RLS enabled, all created in
`supabase/migrations/2026092812*.sql` (ordered, deterministic,
non-destructive — none of them touch a Section 01/02 structure, since
none existed):

| Table | Purpose |
|---|---|
| `users` | Application identity anchored to a verified Telegram user. `telegram_user_id` is the anchor — never `username` (can change, can be absent). |
| `licenses` | License history for a user. Never deleted on expiry/revocation. |
| `license_entitlements` | Per-license feature flags, `feature_key` restricted by a `CHECK` to the 9 keys `@sport-os/platform`'s `Entitlement` const already named in Section 01. |
| `license_limits` | Per-license numeric limits. Exactly one row per license (a deliberate tightening beyond the spec's suggested fields — see the table's own comment in its migration). |
| `auth_sessions` | Persistence layer over Section 02's stateless session tokens, added for revocation (see `TELEGRAM_AUTHENTICATION.md`'s session architecture update). |
| `audit_logs` | Append-only. `metadata` must never contain secrets — see "Audit model" below. |
| `platform_settings` | Singleton table (`id boolean primary key default true`, `CHECK (id)`), tracking whether the one-time OWNER bootstrap has run. |

Enum values (`user_role`, `user_status`, `license_status`) are
**lowercase**, matching the runtime string values Section 01 already
locked in `@sport-os/platform`'s `Role`/`LicenseStatus` consts
(`'owner'`/`'admin'`/`'user'`, `'trial'`/`'active'`/…) — chosen over the
Master Blueprint prose's uppercase spelling specifically so the
TypeScript and SQL layers need no case-mapping translation layer (one
fewer place for a bug to live). `user_status` (`'active'`/`'suspended'`/`'disabled'`)
is new in Section 03; there was no Section 01 precedent to preserve.

`role` and `status` are deliberately separate columns/axes on `users` —
a user can be `ACTIVE` with an `EXPIRED` license, or `SUSPENDED` with an
otherwise-valid license. Nothing in this codebase collapses the two.

## RLS design

Every policy expresses actual authorization — there is no
`USING (true)`/`WITH CHECK (true)` anywhere in
`20260928120900_rls_policies.sql` for a sensitive table. The shape used
throughout:

- **No policy for an operation = that operation is fully denied** for
  that Postgres role once RLS is enabled. `users`/`licenses`/etc. have no
  INSERT policy for `authenticated`/`anon` at all — user/license creation
  only ever happens server-side via the service role.
- **`service_role` bypasses RLS entirely** (a Postgres/Supabase built-in
  property of that role) — it is the only role permitted to mutate
  `licenses`, `license_entitlements`, `license_limits`, `auth_sessions`,
  `audit_logs`, and `platform_settings` in the application's actual,
  live request path today (see "Service-role security" below).
- **Role/status changes on `users` cannot be expressed as a column
  GRANT alone.** Supabase's Postgres roles are shared across every
  application-level role — `authenticated` is the ONE Postgres role for
  every logged-in user, whether their `users.role` is `user`, `admin`,
  or `owner`. A column `GRANT` is per-Postgres-role, so it can't say
  "admin may write this column, user may not" — only a per-ROW check
  can. `enforce_user_self_service_boundaries` (a `BEFORE UPDATE` trigger,
  `20260928120850_users_self_service_guard.sql`) is that check, layered
  on top of the RLS policy and the column grant, not instead of them:
  - Nobody may change their own role or status through this path — not
    even an OWNER.
  - Changing anyone else's role requires `is_admin()`.
  - Setting a row's role to/from `'owner'` additionally requires
    `is_owner()` — an ADMIN can never create or remove an OWNER.
  - The trigger exempts `service_role` (its own writes are authorized by
    `@sport-os/platform`'s admin operations before they ever reach SQL —
    see "Authorization" in `AUTHORIZATION.md`), since `auth.uid()` is
    always NULL on a service-role connection and would otherwise
    incorrectly reject every legitimate service-role role change.
- **`license_key` is never granted to the `authenticated` role at
  all** — not even for the license's own owner. `SupabaseLicensesRepository.getRawLicenseKey()`
  (service-role only) is the one place a raw key is ever read, for a
  dedicated, explicitly-invoked, audited operation — never an ordinary
  SELECT.
- **`platform_settings` has no grant for `anon`/`authenticated` at
  all** — only `service_role` can reach it, confirmed by
  `tests/database/20_rls_cases.sql`'s tests 22b/22c/22d.

## RLS identity helper — the integration boundary that isn't built yet

`current_app_user_id()` wraps Supabase's own `auth.uid()` (reads the
`sub` claim of the request's Supabase-verified JWT — documented,
built-in Supabase behavior, not invented here). `current_app_role()` /
`is_owner()` / `is_admin()` look up the caller's row in `public.users`
by that same id, as `SECURITY DEFINER` functions (narrowly scoped: no
caller input, one row, an explicit `search_path` — the sanctioned use
case for `SECURITY DEFINER`, not a general escape hatch).

**No bridge exists yet from a Section 02 Telegram session to a Supabase
Auth JWT.** This codebase does not adopt Supabase Auth, and does not
create fake `auth.users` records — per the spec's explicit instruction,
"do not pretend Telegram users are automatically Supabase Auth users."
The practical consequence: `auth.uid()` is `NULL` for every request
today, so `is_admin()`/`is_owner()` correctly return `false` by default,
and the `authenticated`-role RLS policies are **not yet reachable by any
live code path** — they exist, are correct, and are validated by
`tests/database/` (which simulates a Supabase-issued JWT via
`SET LOCAL request.jwt.claims`), ready for the day a real bridge is
built, but today's actual Mini App traffic never authenticates as
`authenticated` at the Postgres level at all.

**Today's real request path is entirely service-role-mediated instead**:
the Mini App calls a Supabase Edge Function (`telegram-auth`, `me`,
`owner-bootstrap`), which verifies the caller's Section 02 session token
itself, then uses a service-role Supabase client to perform the
authorized operation. Authorization for that path is enforced in
**application code** — `@sport-os/platform`'s admin operations
(`suspendUser`, `changeUserRole`, etc.) and `authorization.ts`'s guards —
mirroring, deliberately, the exact same rules the RLS policies encode,
so switching to a direct-`authenticated`-role architecture later remains
safe (the same rules already exist at both layers). See
`AUTHORIZATION.md` for the full authorization flow and
`OPEN_QUESTIONS.md` for this gap tracked as a genuine open question.

## Service-role security

- Service-role operations are server-side only: the key
  (`SUPABASE_SERVICE_ROLE_KEY`) is read only by
  `packages/platform/src/db/client.ts`'s `createServiceRoleClient()` and
  by the Deno edge functions' `Deno.env.get(...)` — never by
  `apps/mini-app`, and confirmed absent from its built bundle (see the
  security/bundle scan in the PR description).
- It bypasses RLS entirely — that is what it's for — so **every function
  in `@sport-os/platform` that accepts a service-role client performs
  its own authorization check first** (`requireAdmin`/`requireOwner`/
  `requireNotSelf` from `authorization.ts`) before using it. A
  service-role client is never handed to code whose caller hasn't
  already been authorized.
- It is never used as a substitute for RLS: RLS stays enabled and
  correctly restrictive on every table regardless of whether any code
  path currently uses the `authenticated` role — see "RLS identity
  helper" above.

## Audit model

`audit_logs` is append-only by two independent mechanisms: no
UPDATE/DELETE policy exists for any client role (RLS), and
`SupabaseAuditService`/the edge functions' `recordAuditEvent()` never
issue an UPDATE/DELETE against it either (a documented convention, not
DB-enforced for `service_role`, which could technically do so).

`metadata` is passed through `@sport-os/shared`'s `redact()` before
being written — the same pattern Section 02 applied to logs, applied
here to the persisted trail. `redact()`'s pattern gained a
`license[_-]?key` case in Section 03 specifically so a caller mistake
(accidentally including a raw license key in metadata) is caught rather
than permanently stored — see `packages/platform/src/audit.test.ts`'s
"redacts secret-shaped metadata" test for the verification.

Events established: `telegram_user_created` / `telegram_user_authenticated`
(edge function), `user_suspended` / `user_reactivated` / `role_changed`
(`user-admin.ts`), `license_created` / `license_updated` /
`license_suspended` / `license_revoked` / `entitlement_changed` /
`limit_changed` (`license.ts`'s admin operations), `owner_bootstrapped`
(`owner-bootstrap.ts`), and `telegram_authentication_failed` (edge
function, on a validation failure — deliberately not every possible
denial, to avoid "unactionable noise"; see `AUTHORIZATION.md`).

## Indexes

Every index the spec named exists, with one documented simplification:
where a `UNIQUE` constraint (or a partial unique index) already creates
the equivalent index — `users.telegram_user_id`, `licenses.license_key`,
`license_limits.license_id`, `auth_sessions.session_id`/`token_hash` —
no separate duplicate index was added; each table's migration comments
say so explicitly at the point a spec-named index would otherwise be
expected.

## Migration safety

Migrations are ordered by timestamp filename, each does exactly one
thing, and none is destructive (every one of them is a pure `CREATE`,
since no Section 01/02 table existed to modify). All eleven were applied
against a real, locally-installed PostgreSQL 16 instance with zero
errors — see `tests/database/run.sh` and the PR description's
verification transcript.
