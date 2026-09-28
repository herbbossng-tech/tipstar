# Licensing (Section 03)

## Model

```
License
  ├─ status: TRIAL | ACTIVE | SUSPENDED | EXPIRED | REVOKED
  ├─ startsAt / expiresAt
  ├─ Entitlements (data-driven feature flags)
  └─ Limits (numeric caps, independent of entitlements)
```

`packages/platform/src/license.ts` is the single source of truth,
extended from Section 01 without breaking it (see "Section 01
compatibility" below).

## License states

Exactly the five the spec locks — `TRIAL`, `ACTIVE`, `SUSPENDED`,
`EXPIRED`, `REVOKED` (`LicenseStatus`, unchanged from Section 01). No
additional state exists.

**License status is not user status.** A user can be `ACTIVE` with an
`EXPIRED` license, or `SUSPENDED` with an otherwise-valid one — see
`DATABASE_AND_RLS.md`.

## License validity

A license is usable only when (`isLicenseUsable()`):

1. `status` is `TRIAL` or `ACTIVE`, **and**
2. `startsAt` (if set) has passed, **and**
3. `expiresAt` (if set) has not passed.

`licenseAllows(license, entitlement, now)` — Section 01's original
entry point, unchanged in shape — is `isLicenseUsable(license, now) &&
license.entitlements.includes(entitlement)`.

Expired/revoked/suspended licenses are **never silently reactivated** —
nothing in this codebase transitions a license's status except the
explicit admin operations (`suspendLicense`/`revokeLicense`/`updateLicense`),
each authorization-checked and audited.

## License uniqueness

One user may have any number of **historical** licenses, but at most one
**currently TRIAL or ACTIVE** license at a time — enforced at the
database level by a partial unique index
(`licenses_one_active_per_user_idx ... WHERE status IN ('trial', 'active')`)
and, redundantly, by `InMemoryLicensesRepository.insert()` for the same
invariant in tests. Expiring or revoking a license **never deletes the
row** — history stays queryable for audit (`tests/database/`'s test 20,
`license.test.ts`'s "historical (revoked) licenses remain queryable").

## Entitlements

The 9 locked feature keys from Section 01's `Entitlement` const —
`football_analysis`, `football_tickets`, `football_automation`,
`aviator_analysis`, `aviator_automation`, `telegram_auto_publish`,
`telegram_multi_channel`, `weekly_reports`, `advanced_analytics` — are
the **only** values `license_entitlements.feature_key` accepts (a `CHECK`
constraint). Entitlements are strictly data-driven: nothing in this
codebase infers an entitlement from `plan` — a plan name is just a label
until an admin operation explicitly assigns the entitlement rows that go
with it (`assignEntitlement`/`removeEntitlement`).

A missing `license_entitlements` row for a feature and an `enabled =
false` row are treated identically: not entitled. `getEntitlements()`
only ever returns the currently-enabled feature keys.

## Limits

Distinct from entitlements: a feature can be enabled and still
constrained (`max_destinations`, `max_tickets_per_day`,
`max_analysis_requests_per_day`, `max_aviator_signals_per_day`). `NULL`
always means "no configured limit," never zero (`checkLicenseLimit(null,
n) === true` for any `n`). This section implements the typed limit
contract only — no usage counters exist yet (no concrete requirement for
them was given).

## License key protection

`license_key` is sensitive and is **never** granted to the
`authenticated` Postgres role, self or admin, row-level policy
notwithstanding (see `DATABASE_AND_RLS.md`'s RLS design). The one place a
raw key is ever read is `SupabaseLicensesRepository.getRawLicenseKey()`
— a dedicated, explicitly-invoked, service-role-only method, never
called from an ordinary read path. Every other license read (`getById`,
`listForUser`, the `/me` edge function, etc.) uses the safe column set
(`LICENSE_SAFE_COLUMNS` in `license.ts` / `LicenseRow` in `db/types.ts`)
that excludes it entirely.

`generateLicenseKey()` produces a random 24-byte, base64url-encoded
token (`LIC-...`) via Web Crypto — never derived from user-visible data
(Telegram id, username, timestamp).

## Admin operations

`createLicense` / `updateLicense` / `suspendLicense` / `revokeLicense` /
`assignEntitlement` / `removeEntitlement` / `setLicenseLimit`, all in
`license.ts`. Every one: checks `requireAdmin(actingUser)` first, then
performs the operation via the injected repository, then records an
audit event — in that order, always. A plain `USER` gets an
`AuthorizationError` from every one of these before anything is
persisted or audited — see `license.test.ts`'s "license admin
operations" suite.

## Section 01 compatibility

Nothing here silently changed a Section 01 contract:

- `License.startsAt` is a new, **optional** field (`startsAt?:
  ISODateString`), following the same additive pattern Section 02 used
  for `AppErrorInit.code?: string`. Every existing Section 01 test/call
  site that never set it keeps passing unchanged — `isLicenseUsable`
  treats an absent `startsAt` as "no start restriction," exactly
  Section 01's original behavior.
- `LicenseService.getLicense`/`hasEntitlement` are unchanged; the
  Section 03 spec's named capabilities (`getLicenseForUser`,
  `getEntitlements`, `getLimits`, `isLicenseActive`, `checkLimit`) were
  **added** alongside them, not in their place.
- `NotImplementedLicenseService` still implements the full (now larger)
  interface, throwing `NotImplementedError` for every method, preserving
  the Section 01 "explicit not-yet-implemented boundary" pattern for any
  caller that hasn't migrated to `DatabaseLicenseService`.
