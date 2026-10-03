# License Administration (Section 11 Part B/C)

## Purpose

Section 03 already built real, backend-enforced license mutations
(`createLicense`/`suspendLicense`/`revokeLicense`/`assignEntitlement`/
`removeEntitlement`/`setLicenseLimit`). Section 11 adds only the
genuinely missing pieces: the two reverse/renewal transitions, and
composed admin READ views. **Nothing in Section 03's state machine,
roles, or entitlement keys changed.**

## What's new

### `renewLicense(licenses, actingUser, licenseId, newExpiresAt)`

Extends an ACTIVE or EXPIRED license's `expiresAt` and (for EXPIRED)
restores `status: ACTIVE`. Locked rules:

- **REVOKED is terminal.** `renewLicense` on a REVOKED license is
  refused — revocation is a one-way decision in Section 03's own model,
  and Section 11 does not weaken it.
- **SUSPENDED must be reactivated first.** Renewing a SUSPENDED license
  directly is refused — `reactivateLicense` is the only path out of
  SUSPENDED, so an admin cannot skip past "why was this suspended?" by
  renewing it blind.
- `requireAdmin()` gates every call; the real transition still goes
  through the same repository Section 03 built.

### `reactivateLicense(licenses, actingUser, licenseId)`

The one reverse transition: SUSPENDED → ACTIVE. Any other starting
status is refused.

### `listUsersForAdmin(deps, actingUser, params)`

A bounded (`limit`/`offset`, both clamped), newest-first list combining
`UsersRepository.listAll()` with each user's current license summary —
never a second licensing computation, just composition. No
`currentLicensePlan` field: the domain `License` type never surfaces
`plan` (only the DB row does), so the DTO leaves it out entirely rather
than guessing.

### `inspectUserForAdmin(deps, actingUser, targetUserId)`

A single user's full detail: identity, every license on file (not just
the active one), current entitlements/limits, destination-created count
(via `TelegramDestination.createdBy`, additive since Section 10), and
last-authenticated timestamp. Authorization depends **only** on the
real, separately-resolved `actingUser` — never on anything the target
user's own data claims (proven by `SECTION11 ADVERSARIAL E/F`).

## The effective OWNER vs ADMIN matrix (Part C)

Section 03's `requireAdmin()`/`requireOwner()` already treat OWNER and
ADMIN identically for every license/entitlement mutation — there is no
Section 03 rule that further restricts ADMIN below OWNER for these
specific actions. Section 11 **preserves this exactly** rather than
inventing a narrower ADMIN tier that Section 03 never specified:

| Capability | OWNER | ADMIN | USER |
|---|---|---|---|
| License/entitlement/limit mutations | ✅ | ✅ | ❌ |
| Platform settings (read) | ✅ | ✅ | ❌ |
| Job inspection + authorized retry | ✅ | ✅ | ❌ |
| Weekly report generation/publication | ✅ | ✅ | ❌ |
| Agent operations visibility | ✅ | ✅ | ❌ |
| Audit/health read access | ✅ | ✅ | ❌ |

This is documented in `operations/authorization-matrix.ts`'s
`AUTHORIZATION_MATRIX`/`canPerform()` — a **read-only, presentation-only**
summary. The real authority for every row above remains the actual
`requireAdmin()`/`requireOwner()` call at each function's own entry
point; `canPerform()` is never itself consulted to permit or deny a
mutation.

## Never trusted as authorization

- A Telegram command argument, a URL query param, or a frontend-supplied
  role/user-id claim. Every mutation re-resolves `actingUser` from the
  caller's own verified session/identity, never from anything the
  request body or URL says about who they are or what they may do.
- Self-elevation: no function in this module lets a caller grant
  themselves a role or entitlement they don't already have authority to
  grant to others — role changes remain Section 03's `updateRole()`
  path, untouched by Section 11.

## Owner-bootstrap protection

Section 03's one-time OWNER bootstrap claim (`claim_owner_bootstrap()`)
is unmodified. `getPlatformSettingsSnapshot()` only ever *reads* whether
the claim has happened (`ownerBootstrapAvailable`); Section 11 adds no
new way to perform or repeat that claim.
