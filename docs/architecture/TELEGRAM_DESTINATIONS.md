# Telegram Destination Management (Section 10 §8-§10)

## Purpose

A "destination" is a configured Telegram chat (channel, group,
supergroup) this codebase may publish to. Destination management is
OWNER/ADMIN-controlled and backend-enforced — "frontend is not
security." This document covers the locked field list, the
verification model, and the authorization pattern every mutation goes
through.

## The locked field list

`TelegramDestination` (`packages/telegram/src/types.ts`) is intentionally
narrow — do not add an unrelated business field to it:

```ts
interface TelegramDestination {
  destinationId: UUID;
  telegramChatId: string;
  name: string;
  type: "channel" | "group" | "supergroup" | "private";
  enabled: boolean;
  autoPublish: boolean;
  publishBookingCode: boolean;
  publishTicket: boolean;
  publishResults: boolean;
  publishWeeklyReport: boolean;
  createdAt: ISODateString;
  // Section 10 additions:
  verificationStatus?: "unverified" | "verified" | "failed";
  verifiedAt?: ISODateString;
}
```

`supergroup` is additive to Section 01's original `channel`/`group`/
`private` set — it is Telegram's own distinct chat type for a group
upgraded past the legacy 200-member "basic group" limit, with different
admin/permission semantics from a plain `group`. The database mirror
(`telegram_destination_type`) adds it the same way.

A richer publication policy (permitted markets/leagues, data quality,
model agreement, daily limits, publication window, mode, Sport Agent
Card/pick toggles) deliberately does **not** live on this type — see
`PUBLISHING_POLICY.md`'s `PublicationPolicyConfig`, a separate, versioned
parameter object, mirroring Section 07's `DecisionPolicy`/
`TicketRiskLimits` precedent ("policy is a parameter, not a row field").

## Verification — never VERIFIED by default

A destination is always created `unverified`. `verifyDestination()`
(`packages/agents/src/destination-manager.ts`) calls the real
`TelegramService.getChat()` against the configured `telegramChatId`:

- `getChat()` succeeds → `verificationStatus: "verified"`,
  `verifiedAt: now`.
- `getChat()` fails (chat not found, bot has no access, …) →
  `verificationStatus: "failed"`, `verifiedAt` cleared.

Both outcomes are a *successful* admin action — "store an explicit
unverified/incomplete state rather than pretending success" is itself
what this function is for. Only a real authorization failure or an
unknown destination id returns an error. The Publishing Policy Engine
(`PUBLISHING_POLICY.md`) refuses to publish to anything that isn't
`verified` — a `DESTINATION_NOT_VERIFIED` rejection, checked before any
business-policy field.

`getChatMember()` exists on `TelegramService` but is not yet called
during verification — see `OPEN_QUESTIONS.md` #28 for why (no resolved
bot user id to check membership for) and what a stronger guarantee would
require.

## OWNER/ADMIN authorization — never Telegram chat membership

Every mutation in `destination-manager.ts` — `createDestination`,
`verifyDestination`, `updateDestinationSettings`, `disableDestination`,
`listDestinations`, `getDestination` — starts with
`requireAdmin(actingUser)` (`@sport-os/platform`), the same guard
`user-admin.ts` (Section 03) uses. `isAdmin()` is true for both `ADMIN`
and `OWNER` roles. This is an application-level *and* database-level
check:

- **Application level** — `requireAdmin()` runs before anything else in
  every function above; a denial never reaches the repository.
- **Database level** — `telegram_destinations`/`telegram_publications`
  have no `authenticated`-role INSERT/UPDATE/DELETE policy at all (see
  the RLS migration). Every write goes through a service-role-backed
  repository that has already run the application-level check — exactly
  like every other admin-gated table in this codebase.

Telegram chat membership/admin status is never treated as authorization
for a destination mutation — being an admin *in the Telegram chat* says
nothing about whether this account is OWNER/ADMIN *in this system*.

## `updateDestinationSettings` cannot change identity fields

`DestinationSettingsPatch` is typed as
`Partial<Pick<TelegramDestination, "name" | "enabled" | "autoPublish" | "publishBookingCode" | "publishTicket" | "publishResults" | "publishWeeklyReport">>`
— there is no way, even at the type level, to pass `telegramChatId`,
`type`, `verificationStatus`, or `verifiedAt` through this function.
Changing which chat a destination points at is a new destination, not
an edit; verification state is owned exclusively by `verifyDestination()`.

## Audit

Every mutation records a `SupabaseAuditService` event
(`destination_created`/`destination_verified`/
`destination_verification_failed`/`destination_updated`/
`destination_disabled`) with the acting user as `actor`, the
destination id as `resourceId`, and a safe, non-secret metadata payload.

## Bot commands

`apps/bot`'s `/destinations` (list) and `/verifydestination <id>`
expose a deliberately small subset of this service's capabilities —
"provide only the service/domain capabilities Section 10 needs... do not
build the full Section 11 ops console." `createDestination`/
`updateDestinationSettings`/`disableDestination` exist in
`destination-manager.ts` for a future structured admin surface, but are
not yet wired to a bot command (free-text argument parsing for a full
destination record is error-prone; a future ops console or a
multi-step bot conversation is the better fit).
