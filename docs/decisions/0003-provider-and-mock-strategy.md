# ADR 0003: Provider interfaces with explicitly-marked mock adapters

## Status
Accepted (Section 01)

## Context
No real sports-data, odds, payment, or affiliate vendor contract exists
yet. The brief is explicit that Tipstar must not be locked to one vendor,
must never fabricate data a vendor doesn't supply, and must never present
mock output as a real prediction.

## Decision
- Every external dependency is defined as a TypeScript interface first:
  `SportsProvider` and its per-domain extensions (`FootballProvider`,
  `BasketballProvider`, `VirtualFootballProvider`, `AviatorProvider`) in
  `packages/sports`; `PaymentProvider` and `AffiliateProvider` in
  `packages/entitlements`; `NotificationProvider` in
  `packages/notifications`.
- Fields a provider doesn't supply are typed `Maybe<T>` (`T | null`) and
  mock adapters return `null` for them rather than inventing a value
  (e.g. `MockFootballProvider.getLineups()` returns `null`, not a made-up
  lineup).
- Mock adapters live under an explicit `mock/` subfolder (or a
  `Mock`-prefixed class name), carry a `/** DEVELOPMENT-ONLY MOCK ADAPTER */`
  header comment, and are never imported from a "production" code path —
  today, nothing in the repository constructs one outside a `*.test.ts`
  file.
- `IntelligenceResult.isMock` is a required boolean, not an optional flag —
  every result must explicitly say whether it came from a mock pipeline.

## Alternatives considered
- **Build the real football/basketball/odds integration now, against a
  chosen vendor.** Rejected for Section 01: no vendor has been selected,
  and doing so now would hard-code a vendor relationship exactly where the
  brief forbids it (Constitution O/Q). The interface is the deliverable;
  the integration is later work plugged into it.
- **Skip mock adapters entirely and leave methods unimplemented (`throw`).**
  Rejected: without a working mock, the Decision Engine, Pick Engine, and
  UI cannot be developed or tested end-to-end before a real vendor
  contract exists, which would stall every downstream section.

## Consequences
- Swapping or adding a sports-data vendor is an isolated change: implement
  the relevant provider interface, register it via `SPORTS_PROVIDER` in
  config, and nothing in `packages/intelligence` or above needs to change.
- Reviewers can grep for `isMock` and the `mock/` folder convention to
  audit that no mock path has leaked into a code path a real user would
  hit.
