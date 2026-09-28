# Authorization (Section 03)

## The five concepts, kept distinct

> "AUTHENTICATION: who is this? AUTHORIZATION: what may this
> authenticated user do? ENTITLEMENT: is this feature included in the
> user's license? LIMIT: how much of that feature may they use? RLS: can
> this database role access this row?"

Concretely, in this codebase:

| Concept | Answered by |
|---|---|
| Authentication | Section 02's `TelegramAuthenticationService` + Section 03's session persistence (`auth_sessions`) — "who is this Telegram user, verified server-side" |
| Authorization | `@sport-os/platform`'s `authorization.ts` guards (`requireAdmin`, `requireOwner`, `requireSelfOrAdmin`, `requireNotSelf`, `requireActiveUser`) — "may this role perform this operation" |
| Entitlement | `licenseAllows()` / `LicenseService.getEntitlements()` — "does the license include this feature" |
| Limit | `checkLicenseLimit()` — "how much of it may they use" |
| RLS | `supabase/migrations/`'s policies — "can this Postgres role read/write this row" |

None of these substitute for another. An authenticated, authorized admin
with an owner-tier license can still be denied a specific feature by
`hasEntitlement()`; a correctly-entitled user can still be blocked by
`checkLicenseLimit()`; and every one of the above can be independently
re-derived at the database layer via RLS, which — per
`DATABASE_AND_RLS.md` — is not yet reachable from the live request path
but exists and is validated regardless.

## Roles

`Role` (`OWNER` | `ADMIN` | `USER`, unchanged from Section 01):

- **OWNER** — full administrative authority: manage users, licenses,
  entitlements, and (implicitly, via `is_admin()`) everything ADMIN can.
  Only an OWNER may create or remove another OWNER
  (`enforce_user_self_service_boundaries`'s trigger,
  `changeUserRole()`'s `requireOwner` branch).
- **ADMIN** — bounded administrative authority: may suspend/reactivate
  users, manage licenses/entitlements/limits, promote a `USER` to
  `ADMIN` — but can never create or remove an `OWNER`, and can never act
  on their own account (see "Self-service is always denied" below).
- **USER** — no administrative authority at all. Every admin operation
  in `license.ts`/`user-admin.ts` rejects a `USER` caller before doing
  anything else.

`isAdmin(context)` is `true` for both `ADMIN` and `OWNER` — an owner also
holds administrative authority. `isOwner(context)` is the strict,
owner-only check.

## User status

`UserStatus` (`ACTIVE` | `SUSPENDED` | `DISABLED`, new in Section 03) is
a separate axis from `role` — see `DATABASE_AND_RLS.md`. `isActiveUser()`
/ `requireActiveUser()` exist for callers that need to gate a protected
operation on account status, independent of role or license.

## Self-service is always denied

Every self-service boundary in this codebase is enforced **twice**,
independently:

1. **Application layer**: `requireNotSelf(actingUser, targetUserId, message)`
   — used by `suspendUser`, `reactivateUser`, and `changeUserRole` before
   anything else runs.
2. **Database layer**: `enforce_user_self_service_boundaries`'s trigger
   on `public.users` — `OLD.id = auth.uid()` is rejected unconditionally
   for both role and status changes.

Neither layer trusts the other to be correct — this is the concrete
meaning of "neither layer should be treated as optional" for this
specific invariant. Verified at both layers independently:
`user-admin.test.ts` (application) and `tests/database/20_rls_cases.sql`
tests 4/5/11 (database).

## Authorization matrix

| Role | Own profile | Other users' data | License admin | Entitlement admin | Global admin (settings/audit reads) |
|---|---|---|---|---|---|
| USER | read + limited self-update (username/first_name/last_name/language_code only) | none | none | none | none |
| ADMIN | same as USER for their own row, plus everything below for others | read/suspend/reactivate/promote-to-ADMIN (never to/from OWNER, never their own row) | full (create/update/suspend/revoke) | full (assign/remove) | audit_logs read; **not** platform_settings |
| OWNER | same as ADMIN | everything ADMIN can, plus create/remove OWNER | full | full | full, including platform_settings (service-role path only — see `DATABASE_AND_RLS.md`) |

Exact boundaries (not the shorthand above) live in
`packages/platform/src/authorization.ts`,
`packages/platform/src/user-admin.ts`,
`packages/platform/src/license.ts`'s admin operations section, and the
RLS policies migration — this table is a summary of those, not a
separate source of truth.

## Owner bootstrap

There is no automatic "first Telegram user becomes OWNER," no first-
registered-user rule, and no hard-coded Telegram id anywhere in this
codebase. Reaching `OWNER` requires **both**:

1. A valid, unexpired, non-revoked Section 02/03 session (the caller
   must have already authenticated via `/telegram-auth`, so a `users`
   row exists for them), **and**
2. The exact `OWNER_BOOTSTRAP_SECRET` — a server-only config value
   (undefined by default, which makes bootstrap permanently unavailable
   — a safe, fail-closed default, not something that must be
   configured) — compared with a timing-safe comparison
   (`timingSafeStringsEqual`) and never logged, echoed, or persisted.

`bootstrapOwner()` (`packages/platform/src/owner-bootstrap.ts`) and its
Deno mirror (`supabase/functions/owner-bootstrap/index.ts`):
promote the target to `OWNER`, mark `platform_settings.owner_bootstrapped_at`
(a singleton row — see `DATABASE_AND_RLS.md`), and record an
`owner_bootstrapped` audit event — all in one operation, and **permanently
disabled** the moment `owner_bootstrapped_at` is non-null: every
subsequent call, correct secret or not, is rejected with
`OWNER_BOOTSTRAP_ALREADY_DONE` (verified: `owner-bootstrap.test.ts`'s
"refuses to run a second time" test, which also confirms the rejected
second target was never actually promoted).

## Failed-authorization auditing

The spec permits, but does not require, recording every denied
authorization attempt ("may also be recorded... do not flood audit
storage with unactionable noise"). This codebase records
`telegram_authentication_failed` for every rejected Telegram
authentication (the highest-value class of failure — a real attacker
touchpoint) but does **not** log every denied admin-operation call (e.g.
a `USER` calling `suspendUser` and being rejected) — those never reach
any UI a non-admin would use, so a real occurrence is more likely a bug
or a deliberate probe either way, and logging every permission check
across the app would be exactly the noise the spec warns against. This
is a deliberate, documented choice, not a gap — revisit it if a concrete
need for broader denial logging arises.

## Session architecture

See `TELEGRAM_AUTHENTICATION.md`'s "Session architecture (Section 03
update)" for the full decision (hybrid: Section 02's stateless token
unchanged, a new `auth_sessions` table adds revocation) — not duplicated
here to avoid two sources of truth for the same decision.
