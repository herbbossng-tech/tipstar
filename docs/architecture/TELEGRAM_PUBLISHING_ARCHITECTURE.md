# Telegram Bot, Multi-Channel Management & Automated Publishing (Section 10)

## Purpose

Sections 01-09 built identity, licensing, football data, intelligence,
the agent framework, decision/risk/execution, settlement/performance,
and a read-only Mini App — but nothing that actually reaches a user on
Telegram with a finalized result. Section 10 closes that gap: a real
Telegram bot with authenticated command routing, an admin-controlled
destination catalog, a Publishing Policy Engine, a message template
engine, and durable, idempotent publication of already-finalized
content through the existing `TelegramChannelManagementAgent`.

**The one rule every other decision in this document follows:**
Telegram is DISTRIBUTION. It is not DECISION, RISK, EXECUTION, or
SETTLEMENT. This boundary may decide WHERE/WHEN/HOW/WHICH destination a
piece of content reaches — never WHAT the prediction/odds/value should
be, WHETHER to execute, WHETHER it won, or WHAT the payout is. Every
value a published message shows was computed upstream (Section 05-08);
this section only formats and delivers it.

## What's new

| Layer | File(s) | What it does |
|---|---|---|
| Bot API client | `packages/telegram/src/service.ts`, `telegram-errors.ts` | `sendMessage`/`replyToMessage`/`getChat`/`getChatMember`, real error categorization, bounded retry, per-attempt timeout |
| Publishing Policy Engine | `packages/telegram/src/policy-engine.ts` | `evaluatePublicationPolicy()` — markets/leagues/data-quality/model-agreement/daily-limit/window checks, extending (not duplicating) `publishing-policy.ts`'s destination-flag check |
| Message templates | `packages/telegram/src/templates.ts` | Pure, deterministic, HTML-escaped renderers for pick/ticket/booking-code/result/performance messages |
| Destination manager | `packages/agents/src/destination-manager.ts` | OWNER/ADMIN-gated CRUD + verification over the real `telegram_destinations` table |
| Publishing authorizer | `packages/agents/src/publishing-authorizer.ts` | Identity/license/entitlement check for publication requests — never a second `GlobalExecutionGate` |
| Channel agent (extended) | `packages/agents/src/telegram-channel-agent.ts` | Durable idempotency, RESULTS reply-to-original, multi-destination fanout |
| Bot | `apps/bot/src/bot.ts`, `commands/*`, `container.ts` | Real command routing: `/start /help /status /account /football /tickets /performance /aviator /destinations /verifydestination` |
| Database | `supabase/migrations/20261001*` | `telegram_destinations`, `telegram_publications`, three new enums, RLS |

## Why no job queue

Publishing is synchronous, per destination, inside one
`TelegramChannelManagementAgent.execute()` call — a `for` loop over
eligible destinations, each one independently sent and recorded. Bounded
retry for TRANSIENT/RATE_LIMITED Telegram failures happens *inline*
inside `TelegramBotApiService.call()` (exponential backoff, honoring a
real `retry_after` when Telegram supplies one). There is no
`publication_jobs` table, no worker process, and `TelegramPublicationStatus`
is deliberately only four states — `PENDING`/`RETRYING`/`PUBLISHED`/
`FAILED` — not the full textbook queue lifecycle (`QUEUED`/`PUBLISHING`/
`CANCELLED` have no distinct real state to occupy under this design). A
policy REJECT never creates a `telegram_publications` row at all — it is
recorded only as an audit event, never a publication attempt.

This is safe at the destination counts this product realistically has
today; see `OPEN_QUESTIONS.md` #30 for when to revisit it.

## Idempotency — the real boundary

The uniqueness guarantee is a Postgres unique index, not application
code: `telegram_publications_natural_key_idx` on
`(source_type, source_id, source_version, publication_type, destination_id)`.
`TelegramPublicationsRepository.findOrCreate()` upserts against that
index with `ignoreDuplicates: true`, then always re-selects by the same
tuple — the same "upsert, ignore duplicate, re-select the winner" pattern
`SupabaseIdempotencyStore.claim()` (Section 06) already established. A
repeated publish request for the same tuple returns the SAME row; if
that row's status is already `PUBLISHED`, `TelegramChannelManagementAgent`
never calls `sendMessage()`/`replyToMessage()` again — it returns the
already-stored `telegram_message_id`. A retry can never create a second
Telegram message. The `idempotency_key` column is recorded for
traceability/audit linkage only — the natural-key tuple above is what is
actually enforced.

## Multi-channel fanout

One ticket may publish to many destinations. `TelegramChannelManagementAgent.execute()`
iterates destinations independently: each one's policy check, send
attempt, and persistence are isolated in their own loop iteration. A
`sendMessage()` failure for destination B is recorded as `skipped` for B
only — it has no effect on destination A or C's own outcome. See
`telegram-channel-agent-publishing.test.ts`'s "TEST B" for the
regression test.

## Result replies (§22)

A `RESULTS` publication looks up
`TelegramPublicationsRepository.findOriginalMessageForReply()` — the
most recent `PUBLISHED` `ticket`/`pick` publication at the same
destination for the same source — and, if one exists, calls
`replyToMessage()` against its real `telegram_message_id`. If none
exists, it falls back to a plain `sendMessage()` rather than fabricating
a reply target. Settlement corrections are never applied by editing the
original message in place; `renderResultMessage()`'s `wasRevised` flag
labels a corrected result explicitly instead.

## Distribution rule, enforced structurally

`TelegramChannelAgentInput.finalizedText` is the complete, final message
body. The agent treats it as opaque — it is passed to
`sendMessage()`/`replyToMessage()` byte-for-byte, with no reformatting,
no re-templating, no recomputation. There is no field on
`TelegramChannelAgentInput` the agent could use to alter a
probability/odds/stake/selection/execution/settlement value even if it
wanted to — this is enforced by the TypeScript type itself, not just by
convention (see the adversarial test "Telegram agent attempts to modify
ticket probability" in `adversarial.test.ts`).

## See also

- [`TELEGRAM_DESTINATIONS.md`](./TELEGRAM_DESTINATIONS.md) — destination
  field list, verification, OWNER/ADMIN authorization.
- [`PUBLISHING_POLICY.md`](./PUBLISHING_POLICY.md) — the full policy
  rejection-code list and the 24 test scenarios behind it.
- [`TELEGRAM_SECURITY.md`](./TELEGRAM_SECURITY.md) — the bot's trust
  model, token handling, and adversarial test coverage.
- [`MODULE_BOUNDARIES.md`](./MODULE_BOUNDARIES.md)'s "Telegram Bot,
  Multi-Channel Management & Automated Publishing Boundary" section.
