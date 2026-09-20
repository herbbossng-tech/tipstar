# ADR 0002: Normalized Postgres schema with RLS keyed off a validated Telegram claim

## Status
Accepted (Section 01)

## Context
Tipstar authenticates users exclusively through Telegram Mini App
`initData`, not Supabase's built-in email/OAuth auth flows. Row Level
Security needs a way to know "which internal user is this request" without
ever trusting a client-supplied user id column, per Engineering
Constitution K/L/M.

## Decision
- Model the domain as normalized tables (`users`, `telegram_identities`,
  `user_roles`, `picks`, `pick_corrections`, `subscriptions`,
  `referral_attributions`, `audit_log`, etc.) rather than a small number of
  JSONB blob tables. JSONB is reserved for genuinely variable-shape data:
  evidence packages, decision reasons, provider raw payloads.
- Add a SQL helper, `tipstar_auth_user_id()`, that reads a
  `tipstar_user_id` claim out of the request JWT (`request.jwt.claims`).
  RLS policies compare row ownership against this function's result, never
  against a value the client can set directly on the row itself.
- The claim is only ever set by the backend, only after
  `packages/telegram`'s `validateInitData()` (or its Deno mirror in
  `supabase/functions/telegram-init-auth`) has cryptographically verified
  the Telegram payload. Issuing the actual signed session/JWT that carries
  this claim is a Section 02+ concern — this ADR fixes the mechanism RLS
  will rely on so that later work has a stable contract to issue tokens
  against.
- Enforce two invariants at the database layer, not only in application
  code: pick identity immutability and settlement monotonicity
  (`enforce_pick_immutability()` trigger), and append-only audit/correction
  ledgers (`forbid_mutation()` trigger on `pick_corrections` and
  `audit_log`).

## Alternatives considered
- **Supabase Auth (email/OAuth) with Telegram as a secondary link.**
  Rejected: the product is Telegram-native; forcing users through a second
  auth flow contradicts the Mini-App-first product vision and adds a
  second identity system to keep in sync for no benefit.
- **Trust a `telegram_user_id` request header directly in RLS.** Rejected
  outright — this is precisely the "client asserts its own identity"
  anti-pattern the brief calls out by name.
- **Enforce pick immutability only in the `PickEngine` application code.**
  Rejected as the sole mechanism: a direct database write (migration
  mistake, manual `UPDATE` during an incident) would silently violate "No
  Hidden Losses" with no record. The trigger makes the invariant hold
  regardless of which code path touches the table.

## Consequences
- Any future auth change (e.g. issuing Supabase-native JWTs instead of a
  custom token) only needs to guarantee the `tipstar_user_id` claim is
  present and trustworthy — no RLS policy needs to change.
- `intelligence_results`, `decision_outcomes`, and `audit_log` intentionally
  ship with **no** client-facing RLS policies yet (service-role only).
  This is a placeholder for a future admin-role policy, not an oversight —
  documented in `docs/architecture/database.md`.
