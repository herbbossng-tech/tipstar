# Publishing Policy Engine (Section 10 §12-§13)

## Purpose

Two policy checks exist, deliberately layered rather than merged:

1. **`evaluatePublishingPolicy()`** (`publishing-policy.ts`, Section 06,
   unchanged) — the narrow check: does this destination's own
   `publish_*` flag allow this content type at all?
2. **`evaluatePublicationPolicy()`** (`policy-engine.ts`, Section 10) —
   the richer check: markets, leagues, data quality, model agreement,
   accumulator/single restrictions, daily limits, publication window,
   entitlement, destination/integration availability, ticket finality.
   It calls (1) internally as its final step — never a duplicate
   reimplementation.

A caller that supplies only a `contentType` gets check (1); supplying a
full `PublicationPolicyConfig` + `PublicationCandidate` additionally
gets check (2). `TelegramChannelManagementAgent` runs (1) unconditionally
and (2) only when both are present — fully backward compatible with
every Section 06 caller.

## No invented "confidence" field

> "Probability is NOT confidence... do not manufacture one... use only
> established backend fields."

Every field `PublicationCandidate`/`PublicationPolicyConfig` check
against already exists elsewhere in this codebase for a different,
real reason:

- `worstDataQuality` mirrors `@sport-os/football-engine`'s `FeatureQuality`
  (`AVAILABLE`/`MISSING`/`STALE`/`INVALID`).
- `modelAgreementRatio` mirrors `@sport-os/risk-engine`'s
  `TicketRiskLimits.minimumModelAgreementRatio`/
  `TicketRiskInput.modelAgreementRatio` exactly.
- `isFinal` is computed upstream from the real Section 07 ticket status
  (never DRAFT) — this engine only reads the boolean.

There is no field anywhere named `confidence`, and none is computed
here.

## The rejection codes

`PublicationPolicyRejectionCode` is a closed, locked set. Every
`REJECT` result carries exactly one of these, plus a human-readable
reason — a publication is never silently discarded:

| Code | Meaning |
|---|---|
| `POLICY_DISABLED` | The policy itself, or a Sport-Agent-Card/pick toggle on it, is off |
| `MARKET_NOT_PERMITTED` | A leg's market is outside `permittedMarkets` |
| `LEAGUE_NOT_PERMITTED` | A leg's league is outside `permittedLeagues` |
| `DATA_QUALITY_TOO_LOW` | Worst leg data quality is below the policy minimum |
| `MODEL_AGREEMENT_TOO_LOW` | Model agreement ratio is below the policy minimum |
| `DAILY_TICKET_LIMIT_REACHED` | `publicationsToday` has met `maxPublicationsPerDay` |
| `OUTSIDE_PUBLICATION_WINDOW` | Outside the configured UTC hour window |
| `ENTITLEMENT_MISSING` | Caller lacks the Telegram publishing entitlement |
| `TICKET_INVALID` | The ticket has no legs |
| `TICKET_NOT_FINAL` | The source ticket is not in a finalized state |
| `DESTINATION_DISABLED` | The destination is disabled (or its own flag check fails) |
| `DESTINATION_NOT_VERIFIED` | The destination has never been `verified` |
| `INTEGRATION_UNAVAILABLE` | The Telegram integration itself is unavailable |
| `ACCUMULATOR_NOT_PERMITTED` | Policy disallows accumulators |
| `SINGLE_NOT_PERMITTED` | Policy disallows singles |
| `BOOKING_CODE_UNAVAILABLE` | No real booking code exists yet |

## Evaluation order — deterministic, first-failure-wins

Mirrors `GlobalExecutionGate.authorize()`'s own "stop at the first
denial" pattern: entitlement → policy enabled → destination enabled →
destination verified → integration available → (for ticket/pick
content) finality → legs present → single/accumulator permission →
market/league/data-quality/model-agreement → (for booking codes) code
presence → Sport-Agent-Card/pick toggle → daily limit → publication
window → the narrow destination-flag check. The same inputs always
produce the same decision.

## Policy is a parameter, not a destination field

`PublicationPolicyConfig` is versioned (`policyVersion`) and supplied
alongside a publication request — never a field on `TelegramDestination`
itself (`TELEGRAM_DESTINATIONS.md`'s locked field list has no room for
it). This mirrors Section 07's `DecisionPolicy`/`TicketRiskLimits`
precedent exactly.

## `publicationsToday` — a real count, never estimated

`PublicationPolicyContext.publicationsToday` is the caller's own,
already-counted figure — this engine never computes it.
`TelegramChannelManagementAgent` sources it from
`TelegramPublicationsRepository.countPublishedSince()`, a real
`SELECT count(*) ... WHERE status = 'PUBLISHED' AND created_at >= $since`
against the database, not an in-memory tally.

## Test coverage

`packages/telegram/src/policy-engine.test.ts` carries 24 scenarios (one
per rejection code, plus the window/limit boundary and full-ALLOW
cases) — see that file for the exact table. `telegram-channel-agent-publishing.test.ts`
covers the engine wired into the real agent: idempotent retries,
multi-destination fanout, and result replies.
