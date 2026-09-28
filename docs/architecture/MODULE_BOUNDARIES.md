# Module Boundaries

## The 14 backend/service boundaries

Where each lives, and its Section 01 implementation status. "Real" means
genuine, tested logic exists today (not a placeholder that fakes
production data); "NotImplemented" means the interface is fixed and a
concrete class throws `NotImplementedError` from every method; "contract
only" means an interface exists with no default implementation at all
(nothing to construct yet).

| # | Service | Package | File | Status |
|---|---|---|---|---|
| 1 | IdentityService | `@sport-os/platform` | `identity.ts` | NotImplemented (needs persistence — Section 03) |
| 2 | LicenseService | `@sport-os/platform` | `license.ts` | NotImplemented persistence; `licenseAllows()` decision rule is **real** |
| 3 | AgentService | `@sport-os/agent-core` | `agent-service.ts` | **Real** (`InMemoryAgentRegistry`) |
| 4 | FootballService | `@sport-os/football-engine` | `service.ts` | NotImplemented (depends on the whole football pipeline) |
| 5 | AviatorService | `@sport-os/aviator-engine` | `service.ts` | NotImplemented (depends on the whole Aviator pipeline) |
| 6 | RiskService | `@sport-os/risk-engine` | `service.ts` | NotImplemented (sport-specific risk models). Note: `GlobalDailyRiskController` in the same package is **real** — it is a different, cross-sport concern. |
| 7 | MarketService | `@sport-os/market-engine` | `service.ts` | NotImplemented (needs a real odds provider) |
| 8 | TicketService | `@sport-os/settlement-engine` | `service.ts` | NotImplemented (needs the Decision Engine) |
| 9 | SettlementService | `@sport-os/settlement-engine` | `service.ts` | NotImplemented (needs real match results). Ticket rules (`rules.ts`) are **real**. |
| 10 | TelegramService | `@sport-os/telegram` | `service.ts` | **Real** (`TelegramBotApiService`, a thin Bot API client) |
| 11 | PublishingService | `@sport-os/telegram` | `service.ts` | NotImplemented (needs a persisted destination catalog). The Publishing Policy Engine (`publishing-policy.ts`) that decides *whether* a destination accepts content is **real**. |
| 12 | ReportingService | `@sport-os/platform` | `reporting.ts` | NotImplemented (needs real settled data) |
| 13 | AuditService | `@sport-os/platform` | `audit.ts` | **Real** (`InMemoryAuditService`) |
| 14 | HealthService | `@sport-os/platform` | `health.ts` | **Real** (`buildHealthReport`); exposed via `supabase/functions/health` |

## Agent Core

See [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md) for the Agent
contract, lifecycle, and how every named agent in the product definition
maps to `AgentType`.

## Global Execution Gate

`@sport-os/platform`'s `GlobalExecutionGate` implements the fixed-order
pipeline (identity → license → entitlement → risk → integration
availability → execution authorization) as real orchestration: a list of
injected `GateCheck`s, evaluated in order, short-circuiting on the first
denial. No individual check's business logic is implemented in Section
01 — callers inject test doubles today; real checks (backed by
IdentityService, LicenseService, etc.) are wired in as those services
gain real implementations.

## Telegram Foundation

- `validateInitData()` — real, HMAC-SHA256 per Telegram's documented
  Mini App algorithm (ported with tests from prior work, still the only
  place Telegram identity may be trusted from).
- `verifyWebhookSecret()` — real, constant-time comparison.
- `TelegramDestination` — typed, validated (`validateTelegramDestination`),
  never a hard-coded chat id anywhere in this codebase.
- `evaluatePublishingPolicy()` / `selectPublishableDestinations()` — real,
  deterministic: given a destination's own configured flags, decides
  whether it currently accepts a content type. Does not decide *what* to
  publish.
- `TelegramDestinationManager` (CRUD) — `NotImplemented`, needs
  persistence (Section 03).

## Licensing Foundation

`LicenseStatus` (`trial`/`active`/`suspended`/`expired`/`revoked`),
`Role` (`owner`/`admin`/`user`), and `Entitlement` (the 9 named in the
product definition) are fixed types. `licenseAllows(license, entitlement,
now)` is a real, tested pure function: a license in good standing
(`trial`/`active`), not expired, carrying the entitlement. It is not
wired into any request path yet — that requires `IdentityService` and
persistence.

## Global Daily Risk Controller

`@sport-os/risk-engine`'s `GlobalDailyRiskController` is real: it tracks
cumulative P/L from `recordResult(amount)` calls, transitions to
`DAILY_TARGET_REACHED` or `DAILY_STOP_LOSS_REACHED` when a threshold is
crossed, and `isExecutionAllowed()` becomes `false` at that point until
`reset()`. It has no I/O and no model — it operates purely on numbers its
caller supplies, which is why it's safe to implement for real in Section
01 (see `docs/architecture/ARCHITECTURE.md`, Security Principle 8: it
must sit above every automation agent).

## Football Settlement Boundary

`Ticket`/`TicketSelection`/`MatchResult`/`Settlement` types, and the
critical rule — **an accumulator is one ticket regardless of selection
count** — are real and tested (`packages/settlement-engine/src/rules.ts`,
`rules.test.ts`). `PublishedPrediction` and `ExecutedWager` are
structurally distinct types; nothing in this codebase converts one into
the other automatically.

## What's explicitly deferred to later sections

- All model/statistical/ML computation (football-engine, aviator-engine).
- Real provider integrations (football data, odds, Aviator data).
- Persistence for Identity, License, Telegram destinations, Ticket
  publication, Settlement, Reporting (Section 03: database).
- Real execution (any agent actually placing/confirming a wager).
- A concrete `JobScheduler` implementation (contract only today).
