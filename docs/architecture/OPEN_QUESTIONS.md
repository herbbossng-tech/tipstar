# Open Questions

Genuine, unresolved architectural questions only — see Section 01's rule:
"If you discover a genuine architectural conflict: STOP before changing
the architecture. Document the conflict here. Do not silently resolve
it." Nothing here is decided; each is a real ambiguity a later section
(or a direct answer from the architect) needs to resolve before the
dependent work can be built for real.

## 1. What does "double bet" mean for Aviator? — RESOLVED

**Resolved in Section 06.** Of the two readings Section 01 identified,
Section 06's own spec locks the first one: two independent, concurrent
targets on the same round — Target 1 and Target 2 — never a martingale
stake progression across rounds. `packages/aviator-engine/src/double-bet.ts`
now defines the concrete shape: `DoubleBetLeg` (each target's own
stake/cash-out/actual-exit/return/pnl, tracked completely independently),
`DoubleBetRecord` (the combined stake/return/net P&L/ROI, only populated
once both legs settle), `buildDefaultDoubleBetLegs()` (the one place the
locked 50/50 default split is enforced — a caller may still pass an
explicit non-default `target1StakeWeight`, but nothing in this codebase
does so without one), and `settleDoubleBetLeg()`/`combineDoubleBetLegs()`
(real settlement arithmetic from an actual exit multiplier, never a
fabricated one). `@sport-os/agents`' Aviator Automation Agent is the one
caller that constructs a `DoubleBetRecord`, and only through these
functions.

## 2. What are the real SportyBet integration modes?

`SPORTYBET_INTEGRATION_MODE` is scaffolded with three placeholder values
(`manual` | `assisted` | `disabled`) since Section 01 must not assume
SportyBet exposes an undocumented public API (locked rule #7) and must
not implement any CAPTCHA/anti-bot bypass (locked rule #8). The actual
semantics of `manual` vs `assisted` — what a human operator is expected
to do, and what (if anything) the system may automate around that — need
a product decision before the Football/Aviator Automation Agents can be
scoped.

## 3. Does the Mini App's `dashboard` module require access outside Telegram?

The Mini App's `apps/mini-app/src/dashboard` placeholder, plus the
product definition's Telegram-Mini-App-first framing, suggests Telegram
`initData` is the sole identity mechanism. But "dashboard" as a name
sometimes implies broader web access (e.g. a desktop admin view). If a
non-Telegram web login is ever required, `IdentityService` needs a second
resolution path beyond `resolve(telegramUserId)` — worth confirming
before Section 03 designs the identity schema.

## 4. Where does the real session/auth token live once IdentityService is real? (Resolved — Section 03, revocation half; RLS bridge remains open as #8)

Section 02 answered the stateless-token half. Section 03 answered the
revocation half: a hybrid model — Section 02's token format unchanged,
a new `auth_sessions` table adds real revocation on top. See
`docs/architecture/TELEGRAM_AUTHENTICATION.md`'s "Session architecture
(Section 03 update)" for the full design.

**What's still open** (split out as its own question, since it's a
distinct architectural fork, not a detail of this one): whether/how a
Supabase-Auth-JWT bridge is ever built so RLS becomes reachable from the
live Mini App traffic — see question #8.

## 5. `packages/config` and `packages/platform` are additions beyond the blueprint's 8 named packages

Documented as a deliberate physical-arrangement decision, not a
architecture change, in `docs/architecture/ARCHITECTURE.md`'s "Why two
packages beyond the eight the blueprint named". Flagged here in case the
architect disagrees with the grouping (e.g. would prefer Audit/Health
live inside `agent-core`, or Identity/License get their own packages).

## 6. Is a distributed rate limiter required before Section 02's auth endpoint goes live?

`supabase/functions/telegram-auth`'s rate limiting is a single-isolate,
in-memory fixed window — real defense-in-depth, but not a real control
under concurrent/cold Edge Function isolates, which don't share memory.
Whether this needs a shared backing store (Redis, Supabase table-backed
counter, or Supabase's own platform-level rate limiting if any exists) is
unresolved; it wasn't addressed because no production deployment target
was specified for Section 02. Needs a decision before this endpoint is
exposed to real traffic.

## 7. Does `SESSION_SIGNING_SECRET`'s stateless design survive first contact with Section 03's persistence? (Resolved — Section 03)

Yes, by construction: the hybrid design (question #4) keeps
`SESSION_SIGNING_SECRET` and the stateless signature check exactly as
Section 02 built them — the persistence layer added in Section 03
(`auth_sessions`) is additive, not a replacement. No config var was
removed or repurposed.

## 8. Will this codebase ever bridge Telegram identity into a Supabase Auth JWT, so RLS is reachable from live traffic?

Section 03's RLS policies (`users`/`licenses`/etc.) are real, tested
(`tests/database/`), and correct — but **unreachable from any live code
path today**, because nothing mints a Supabase-Auth-compatible JWT for a
Telegram-authenticated user. `auth.uid()` is always `NULL` on the
`authenticated` role today; every actual Mini App request instead goes
through a service-role-mediated Edge Function, with authorization
enforced in application code (`@sport-os/platform`'s guards) — see
`docs/architecture/DATABASE_AND_RLS.md`'s "RLS identity helper".

This works and is secure today, but it means the database's own RLS
layer is currently more of a second, independently-verified copy of the
same rules than a live control. Two ways to close that gap exist and
neither has been chosen:
- **A.** Adopt Supabase Auth properly (create real `auth.users` rows
  linked to `public.users`, mint sessions through Supabase's own auth
  flow) — the "supported" path, but a real architectural commitment this
  section wasn't asked to make ("do not pretend Telegram users are
  automatically Supabase Auth users").
- **B.** Mint a custom JWT signed with the project's JWT secret, carrying
  `sub = users.id`, issued alongside (or instead of) the Section 02/03
  session token — narrower in scope than (A), but is exactly the "weak
  bridge" the spec explicitly warned against inventing casually.

Whoever picks this up needs to decide deliberately, with the trade-offs
above in view, not have it implied by whatever's easiest to wire up at
the time.

## 9. Are `licenses.max_devices` / device-session limits ever going to be enforced, and how?

`auth_sessions` gives Section 04+ everything needed to count a user's
active (non-revoked) sessions, but nothing enforces `max_devices` today
— device fingerprinting was explicitly ruled out
("do not fake device fingerprinting"), and a session-count-based
definition of "device" is a real, buildable, but unmade product
decision. See `TELEGRAM_AUTHENTICATION.md`'s "Device limit foundation".

## 10. When does the owner/admin dashboard UI get built?

Section 03 was explicitly told not to build one ("Do not build the full
owner dashboard in Section 03... UI administration belongs primarily to
later sections") — the backend authorization foundation
(`user-admin.ts`, `license.ts`'s admin operations, the authorization
matrix in `AUTHORIZATION.md`) is real and ready for one, but no UI
consumes it yet, and no section has been assigned to build it.

## 11. Which real football/odds provider(s) will this codebase actually integrate with?

Section 04 built the full provider-agnostic contract
(`FootballDataProvider` and its facets, `ProviderConfig`, bounded
retries) and the config surface to drive it (`FOOTBALL_DATA_PROVIDER`/
`FOOTBALL_DATA_ENABLED`/`FOOTBALL_DATA_BASE_URL`/etc. — see
`../environment-variables.md`), but no real provider was selected or
connected — the section's own rules forbid assuming one without
verification ("do not invent provider APIs", "do not assume a provider
supports a field it has not been verified to support"). Picking a real
provider (and confirming what it actually supports — fixtures only?
odds? team-level stats? player data?) is a product/ops decision no
later section has been assigned yet.

## 12. Who ingests team-level performance observations (`team_observations`), and from what?

`TeamObservationsRepository` (Supabase + InMemory) and the
`team_observations` table are real and RLS-protected, and `LeakageGuard`
already enforces point-in-time correctness against them (see
`LEAKAGE_PROTECTION.md`'s regression test, which seeds them directly).
But `ingestion.ts` has no `ingestTeamObservations()` function, because
`adapters/test-fixture-provider.ts`'s deterministic dataset doesn't
include any raw team-observation records to ingest, and no
`FootballTeamProvider`-facet fetch call exists to source them from
either. The entity was built because Section 05's feature engineering
will need it (rolling form, standings, etc.), per the spec's explicit
list — but wiring an actual ingestion path for it is unaddressed, and
should happen alongside whichever real provider is picked (question
#11), since the right raw shape depends entirely on what that provider
returns.

## 13. Is match-result correction tracking (`corrected_at`/`correction_count`) sufficient, or does it need full historical versioning? — RESOLVED

**Resolved during PR review.** The original scope-trim (a single mutable
row per fixture, UPDATEd in place on correction while preserving the
original `result_recorded_at`) turned out to be a real point-in-time
correctness bug, not just a completeness gap: a historical query using
the preserved original timestamp could see the corrected score —
"Match Result Correction Leakage." `match_results` is now append-only
result VERSIONS (`MatchResultsRepository.insert()`/`getAsOf()`/
`getLatest()`), giving full historical versioning: "what did we believe
the score was at time T" is exactly what `getAsOf(fixtureId, T)`
answers. See `FOOTBALL_DATA_ARCHITECTURE.md`'s "Point-in-time
correctness fixes" and `LEAKAGE_PROTECTION.md`. Section 05's dataset
builder still deliberately derives training labels from
`getLatest()` (the current, possibly-corrected result) rather than
`getAsOf()` — labels are allowed to see the final outcome, that is what
makes them labels — but every feature-history read (`features/history.ts`)
uses the point-in-time-safe resolution the versioned model now makes
possible.

## 14. xG provider availability

**Current decision:** no xG feature is computed; `xg_expected_goals_home`/
`xg_expected_goals_away` are declared (`features/unavailable.ts`) but
always return `MISSING`. **Reason:** no canonical xG field exists
anywhere in the Section 04 data model, and no provider has been
verified to supply it (question #11). **Consequence:** every model in
this section trains and predicts without xG as a signal — its
predictive contribution, if any, is entirely unmeasured. **Next
decision point:** once a real provider is selected (question #11),
confirm whether it actually supplies match-level or shot-level xG
before building the feature for real — never approximate xG from goals
or shots as a stand-in.

## 15. Player/injury/lineup provider availability

**Current decision:** no player-level entity (`Player`/`Lineup`/
`PlayerAvailability`) exists in the canonical model, so no
availability/injury/suspension feature exists either. **Reason:**
Section 04 deliberately avoided "premature player-level complexity" with
no verified provider behind it. **Consequence:** no squad-composition
signal (key player absence, rotation risk) is available to any model
this section built — a real, material gap for football prediction
quality that this section's architecture cannot close on its own.
**Next decision point:** once a real provider confirmed to supply
lineup/injury data is selected, this needs its own canonical entities
(Section 04-style) before Section 05's feature layer can consume them —
likely a small follow-up data-layer extension, not a Section 05 rework.

## 16. Production model artifact storage strategy

**Current decision:** trained model state (tree structures, network
weights) is stored as `jsonb` in `intelligence_model_versions.state`.
**Reason:** at this section's synthetic-data scale, every model's fitted
state is small enough that JSONB is simple and sufficient — no premature
infrastructure. **Consequence:** a production-scale retrain (many more/
deeper trees, a larger network, real historical data volume) could
produce an artifact too large or unwieldy for a JSONB column to be the
right long-term store. **Next decision point:** once real training runs
against real data volume exist, measure actual artifact sizes and decide
whether to move to blob/file storage (e.g. Supabase Storage) with the
table holding only a reference, before JSONB row sizes become a genuine
operational problem.

## 17. Model retraining schedule

**Current decision:** none — nothing in this codebase triggers, schedules,
or automates a retrain. Every model in this section is trained on demand,
once, by a caller supplying `TrainingExample[]` directly. **Reason:** out
of this section's scope, and premature without real production data
flowing in the first place (question #11). **Consequence:** there is no
answer yet to "how often should Elo/Random Forest/GBT/Neural Network be
retrained as new results come in" — a real product/ops decision that
depends on real data volume and velocity, neither of which exist yet.
**Next decision point:** once a real provider is connected and genuine
historical + live data accumulates, decide a retraining cadence (e.g.
weekly, after each matchday) and whether `@sport-os/platform`'s
`JobScheduler` contract (still unimplemented — see question in
`MODULE_BOUNDARIES.md`'s "What's explicitly deferred") is the right
place to drive it.

## 18. `@sport-os/settlement-engine` has no stake/payout amount anywhere — RESOLVED (Section 08)

Discovered building Section 06's Weekly Report Agent. `Ticket`/
`Settlement`/`ExecutedWager` (`packages/settlement-engine/src/types.ts`,
the ORIGINAL Section 01 types, unchanged) carry `WON`/`LOST`/`VOID`/
`PUSH`/`PENDING`/`CANCELLED` status and a stake amount on `ExecutedWager`,
but nowhere was there a real *return*/*payout* amount for a settled
ticket — only the outcome. **Resolution:** Section 08 added a parallel,
richer settlement type — `TicketSettlement`
(`packages/football-engine/src/settlement.ts`) — that carries real
`actualStake`/`actualPayout`/`payoutSource`/`calculatedReturn`/`netPnl`/
`roi` fields, produced by `settleTicket()`'s real market-grading +
accumulator-aggregation + financial-accounting engine. The original,
narrower `Settlement` type was left untouched (still used by
`SettlementAgent`'s legacy Section 06 path) rather than modified in
place, to avoid breaking any existing caller; `SettlementAgent.execute()`
now returns both a narrow legacy `Settlement` view and the full
`richSettlement: TicketSettlement` when settling via the new `richTicket`
path. See `docs/architecture/SETTLEMENT_ARCHITECTURE.md` and
`docs/architecture/FINANCIAL_ACCOUNTING.md` for the full design, and
`docs/architecture/AGENT_CONTRACTS.md`'s Weekly Report Agent entry (still
accurate for the legacy path — the Weekly Report Agent itself was not
migrated to the new `TicketSettlement`-based figures this section, since
that's Section 11's reporting-layer concern, not this section's).

## 19. No real bookmaker/exchange integration exists — relates to question #2

Section 07 built the full typed execution boundary
(`ExecutionIntegration`, extended with `validate()`/`status()`/
`ExecutionResultStatus`), `GlobalExecutionGate`'s real
identity/license/entitlement/risk/integration-availability checks, and
the `execution_requests`/`execution_results` schema — everything an agent
would need to request and audit a real execution. But no authorized
integration was connected (per the spec's explicit stop condition: "if a
real bookmaker/exchange integration is required but not available, do not
invent one"), so `NotImplementedExecutionIntegration` remains the only
implementation and every execution request in this codebase terminates
at `NOT_AVAILABLE`/`MANUAL_REQUIRED`. This is the concrete, current
answer to question #2's "what are the real SportyBet integration modes"
for `manual`: there's no code difference yet between "manual because the
product says so" and "manual because nothing else is possible" — both
paths behave identically today. **Next decision point:** once a specific,
authorized bookmaker/exchange partnership exists (API access, terms of
service permitting programmatic wagering), implement a real
`ExecutionIntegration` against it — this is the one piece of Section 07's
design that cannot be completed without an external, real-world
dependency no amount of further architecture work can substitute for.

## 20. Correlated/joint accumulator probability — only independence-assumption exists

`computeCombinedProbability()` (`ticket-engine.ts`) implements exactly one
method: the product of leg probabilities under an explicit independence
assumption, always tagged `method: "independence_assumption"` and
versioned. `TicketRiskLegInput.correlationGroup`
(`ticket-risk-engine.ts`) is a structured field reserved for a future
correlated-exposure control, but nothing reads it — no correlated/joint
probability model, and no correlation-aware risk check, exists anywhere
in this codebase, because no validated method for computing one was
available to this section. **Consequence:** an accumulator whose legs are
genuinely correlated (e.g. two markets on the same match) has its
combined probability computed as if they were independent — a documented
approximation, not a hidden one, but still a real accuracy gap for
multi-leg tickets that share a fixture or a competition. **Next decision
point:** if/when a validated correlation model exists (or a product
decision to restrict accumulators to independent fixtures is made
instead), extend `computeCombinedProbability()`/`evaluateTicketRisk()` to
use it — informed by that real model, not invented speculatively now.

## 21. Agent workflow persistence beyond a single invocation

Section 06's `AgentInvocationRecord`/`InvocationStatus` track ONE
invocation's lifecycle (IDLE → RUNNING → COMPLETED/FAILED, with a
`WAITING` state for a human-confirmation boundary) durably. A genuine
multi-step workflow that spans several invocations across time (e.g. "a
ticket proposal is created now, waits for a human's ASSISTED
confirmation that may arrive minutes or hours later, then triggers
execution") is representable today only by the CALLER holding the
`correlationId` and dispatching a second, separate COMMAND once
confirmation arrives — there is no durable, resumable "workflow" entity
tying multiple invocations together beyond their shared
`correlationId` (`AgentInvocationsRepository.listByCorrelationId()`).
**Reason:** the spec's §28 "Potential tables" lists `agent_workflows` as
optional ("add migrations only where required"), and no concrete
multi-step workflow exists yet to require one. **Next decision point:**
if/when Section 07+ needs a durable, resumable multi-invocation workflow
(rather than the caller re-dispatching), design `agent_workflows` then,
informed by that real use case rather than a speculative one now.

## 22. No real bookmaker/provider settlement payout format exists — relates to questions #2/#19

Section 08 defined `FootballExecutionAccounting.payout`/`payoutSource`
and the `PayoutSource.PROVIDER` vs `CALCULATED` distinction precisely so
a real provider's payout figure has a place to land, but no real
execution provider is connected (question #19) — so every settlement in
this codebase today either has `payoutSource: undefined` (unexecuted) or,
in the one place execution accounting is exercised end to end (tests and
adversarial scenarios), a caller-supplied synthetic `PROVIDER` value. The
actual shape a real bookmaker/exchange sends back for a settled wager —
whether it reports partial-accumulator payouts, how it represents a
push/void, whether its own accumulator void/push convention matches this
codebase's own §13 policy — is unknown until a real integration exists.
**Next decision point:** when a real `ExecutionIntegration` is
implemented (question #19), verify whether its actual settlement/payout
webhook or polling shape maps cleanly onto `FootballExecutionAccounting`
as designed, or needs an adapter layer; do not assume compatibility
without a real provider to check against.

## 23. No FX conversion layer exists — multi-currency performance stays permanently separated

`@sport-os/settlement-engine/financial.ts`'s `assertSameCurrency()` makes
every financial aggregation in this codebase currency-safe by refusing
(never silently converting) a cross-currency combination — see
`FINANCIAL_ACCOUNTING.md`. This means a deployment operating across
multiple currencies (e.g. NGN and KES) gets fully separate
`PerformanceLedgerEntry` rows per currency, with no single combined "total
P&L across all currencies" figure anywhere. **Next decision point:** if a
genuine product need for a combined cross-currency view emerges, it
requires a real, sourced FX rate layer (with its own versioning/audit
trail, matching this codebase's existing "never silently convert" pattern)
— explicitly out of Section 08's scope per its own stop condition
("currency conversion required but no FX layer exists: stop and report").

## 24. Backtest odds provenance depends entirely on the caller

`simulateBacktestDecision()` enforces that `oddsTimestamp <= example.
snapshotTime` (the `BACKTEST_FUTURE_ODDS` guard), but it has no way to
verify that the `decisionOdds`/`oddsTimestamp` pair the caller supplies
actually came from a real historical `market_observations`/
`odds_observations` snapshot rather than being reconstructed after the
fact. The type-level contract assumes an honest caller; nothing in
`backtest.ts` itself queries Section 04's odds history to cross-check.
**Next decision point:** if a fully-automated backtest runner is built
(rather than a caller assembling `BacktestDecisionPoint`s by hand), it
should resolve `decisionOdds`/`oddsTimestamp`/`closingOdds` directly from
`OddsObservationsRepository`'s own point-in-time queries — never construct
them any other way — so the leakage guard here has something real to
check.

## 25. No repository persists tickets/execution_requests/execution_results to Supabase — the Mini App's Ticket Center is read-only by necessity

Discovered building Section 09's Ticket Center. `packages/agents/src/
db/repositories.ts` (Section 06) implements real Supabase-backed
persistence for exactly two tables — `agent_invocations`/
`agent_messages` — and nothing since has added one for `tickets`/
`ticket_legs`/`decisions`/`risk_evaluations`/`execution_requests`/
`execution_results`/`settlements`/`performance_ledger`/`backtest_runs`
(Sections 07/08 built the real schema, RLS, and pure TypeScript engines
for all of these, but never a repository that writes them to Supabase —
every row in those tables today comes only from `tests/database/
*_fixtures.sql`). **Consequence:** Section 09's `tickets`/`ticket-detail`
edge functions are genuinely correct queries over a real (if currently
empty in production) schema — but a "Confirm execution" write action
could not be built without first building that missing repository layer,
which is new persistence/business logic outside Section 09's UI-only
scope (see MINI_APP_SECURITY.md's "What was not built"). **Next decision
point:** before any Mini App write action (ticket creation, execution
confirmation) can be implemented, a Section 07/08-aligned Supabase
repository layer for these tables needs to exist — informed by whichever
section actually wires agents to real persistence, not invented
speculatively in the UI layer.

## 26. Aviator has no signal/round/Double Bet persistence — the Mini App's Aviator screen is honestly empty

`aviator-engine`'s `signal-engine.ts` (`AviatorSignalState`) and
`double-bet.ts` (`DoubleBetRecord`, real Section 06 settlement
arithmetic) are pure, real TypeScript computation with **no backing
database table anywhere in this codebase** — confirmed by grepping every
migration file for "aviator"/"double_bet"/"signal" (none exist beyond
enum/FK references). `GlobalDailyRiskController` (Section 01, real) is
equally in-memory-only. **Consequence:** Section 09's `AviatorPage`
cannot query real signal/round/daily-risk history because none is ever
persisted — it renders an honest "Aviator unavailable" empty state
(entitlement-gated) rather than inventing a signals table, per the
spec's own explicit stop condition. **Next decision point:** before a
real Aviator Command Center UI can exist, a section needs to design and
build `aviator_signals`/`aviator_rounds`/`aviator_daily_risk_snapshots`
(or equivalent) persistence — no section has been assigned this yet
(see `MODULE_BOUNDARIES.md`'s "What's explicitly deferred").

## 27. No competition-list endpoint exists for the Football screen's filter

`GET /football-fixtures` accepts a `competitionId` query param, but no
endpoint lists the real competitions a caller could filter by — building
one is a small, well-scoped addition (a single `SELECT DISTINCT`-shaped
query over `competitions`), deliberately left out of Section 09's initial
five endpoints per "only implement endpoints actually required" (§46);
the date-only filter already makes the fixture list usable. **Next
decision point:** add `GET /football-competitions` (or fold a
competition list into `/football-fixtures`'s response) when a real UI
need (a populated dropdown, not just a raw text/UUID filter) justifies
it.
