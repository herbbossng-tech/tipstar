# Agent Core

`@sport-os/agent-core` is the reusable contract every agent named in the
product definition eventually implements.

## Every named agent

| Agent | `AgentType` |
|---|---|
| Football Intelligence Agent | `football_intelligence` |
| Football Decision/Ticket Agent | `football_decision` |
| Football Automation Agent | `football_automation` |
| Telegram Channel Management Agent | `telegram_channel_management` |
| Settlement Agent | `settlement` |
| Weekly Report Agent | `weekly_report` |
| Aviator Intelligence Agent | `aviator_intelligence` |
| Aviator Risk Agent | `aviator_risk` |
| Aviator Automation Agent | `aviator_automation` |
| Global Daily Risk Controller | `global_daily_risk_controller` |
| Performance Agent | `performance` |

All eleven are now real, tested `BaseAgent` implementations as of
Section 06 — **except** `Global Daily Risk Controller`, which is
deliberately never wrapped as a peer agent (see "Global Daily Risk
Controller is not an agent" below). Each lives in `@sport-os/agents`,
depends only on already-real Section 01–05 services/engines it consumes
through injection, and never implements Section 07+ business logic
(stake sizing, final risk authorization, bookmaker execution, settlement
math beyond its own contract boundary — see `AGENT_CONTRACTS.md`'s "What
Section 06 does NOT own").

## Lifecycle

```
DISABLED ──────▶ INITIALIZING ──────▶ READY ──────▶ RUNNING
   ▲                  │                 │  ▲            │
   │                  ▼                 │  └────────────┘
   │                ERROR               │   (back to READY)
   │                  │                 ▼
   │                  │              PAUSED
   │                  │                 │
   └──────────────────┴─────────────────┘
```

- `DISABLED → INITIALIZING`
- `INITIALIZING → READY | ERROR`
- `READY → RUNNING | DISABLED`
- `RUNNING → READY | PAUSED | ERROR`
- `PAUSED → RUNNING | DISABLED`
- `ERROR → INITIALIZING | DISABLED`

`BaseAgent.transitionTo()` is the only way a concrete agent changes its
own status, and it throws `ValidationError` (not a silent no-op) on any
transition not in this table — see `base-agent.test.ts` for every
transition exercised, both valid and rejected. `BaseAgent.markReady()`
(Section 06 addition) is a convenience for the extremely common
`DISABLED → INITIALIZING → READY` startup path every concrete agent in
`@sport-os/agents` needs — `transitionTo` itself remains available
directly for any other path.

**This is the AGENT INSTANCE lifecycle** — is this agent process
enabled/healthy right now. It is a completely different axis from the
per-INVOCATION state machine below: one `FootballIntelligenceAgent`
instance stays `READY` across thousands of individual invocations, each
of which has its own independent progress.

## Per-invocation state machine (Section 06 §21)

```
IDLE ──▶ RUNNING ──▶ COMPLETED
                  ╲─▶ FAILED (permanent_failure)
                  ╲─▶ FAILED (retryable_failure) ──▶ RUNNING (retry) ──▶ ...
IDLE|RUNNING ──▶ CANCELLED
RUNNING ──▶ WAITING ──▶ RUNNING   (a human-confirmation boundary, §24)
```

`InvocationStatus` (`packages/agent-core/src/invocation.ts`) and
`isValidInvocationTransition()` enforce this the same way `BaseAgent`
enforces the instance lifecycle above — explicit, validated transitions,
never a silent state change. `AgentInvocationRecord` is the durable
record: `invocationId`/`agentId`/`agentType`/`agentVersion`/
`correlationId`/`requestedBy`/`sideEffectLevel`/`status`/
`failureDisposition`/`failure`/`inputReference`/`outputReference`/
`idempotencyKey`/timestamps — exactly the fields §3 requires every
invocation to have. `InMemoryInvocationsRepository` is the in-process
implementation; `@sport-os/agents`' `SupabaseInvocationsRepository`
persists it for real (see `supabase/migrations/*agent_invocations.sql`).

## Side-effect levels (§5)

`SideEffectLevel` (`packages/agent-core/src/capabilities.ts`) is a total
order from least to most consequential: `READ_ONLY` < `ANALYSIS` <
`PROPOSAL` < `REQUESTED_ACTION` < `EXECUTION`. Every agent declares a
static ceiling in its `AgentDeclaration` (see `AGENT_CONTRACTS.md` for
every agent's actual declaration); `isWithinDeclaredSideEffectLevel()`
is the one mechanical check that enforces "agents must not silently
escalate" — `AgentOrchestrator.dispatch()` calls it before ever invoking
`agent.execute()`, and refuses (recording a `POLICY_REJECTED` failure)
if the dispatch requests a level above the agent's own declared ceiling.

## Typed failures (§22)

`AgentFailureCode` (`packages/agent-core/src/failures.ts`) is the closed
15-value set the spec names — `VALIDATION_ERROR` through
`INTERNAL_ERROR`. `toAgentFailure(error)` maps this codebase's existing
`AppError` hierarchy (`@sport-os/shared`) onto one of these codes; every
path through `AgentOrchestrator.dispatch()` that doesn't produce a valid
output resolves to exactly one typed `AgentFailure`, never a bare thrown
string or an untyped rejection. `isRetryableFailureCode()` is
deliberately conservative (§23: "never blindly retry bookmaker
execution... Telegram publication without idempotency... settlement
mutation") — only `DATA_UNAVAILABLE`/`TIMEOUT`/`INTEGRATION_UNAVAILABLE`
are retryable; every other code (including all of `EXECUTION_REJECTED`/
`POLICY_REJECTED`/`RISK_REJECTED`/`ALREADY_PROCESSED`) describes a
decision that was already final.

## Commands, events, and messages (§18/19)

No agent calls another agent's `execute()` directly anywhere in this
codebase. `AgentMessage<TPayload>` (`packages/agent-core/src/messages.ts`)
is the one typed envelope: `messageId`/`correlationId`/`kind`
(`command`|`event`)/`messageType`/`schemaVersion`/`sourceAgent`/
`targetAgent`/`payload`/`createdAt`/`idempotencyKey`. `CommandType`
("please do this" — `REQUEST_FOOTBALL_INTELLIGENCE`,
`REQUEST_VALUE_ANALYSIS`, `REQUEST_EXECUTION`, ...) and `EventType`
("this already happened" — `INTELLIGENCE_GENERATED`, `TICKET_EXECUTED`,
`RISK_LIMIT_REACHED`, ...) are both closed, named sets — never an ad hoc
string at a call site. `AgentOrchestrator.dispatch()` only ever accepts
a `COMMAND`; dispatching an `EVENT` is rejected outright, so an event can
never accidentally trigger execution. `validateMessageSchemaVersion()`
rejects any message whose `schemaVersion` this build doesn't recognize
— "unknown schema versions must fail safely" — before the message is
ever parsed further.

## Where authorization sits — the Agent Orchestrator (§18/26)

`AgentOrchestrator` (`packages/agent-core/src/orchestrator.ts`) is the
one sanctioned path a `COMMAND` reaches a target agent's `execute()`:

```
Agent A → Typed AgentMessage → AgentOrchestrator → Policy/Permission Check → Agent B
```

`dispatch()`'s order, every step a documented §-numbered rule:

1. Reject an unknown message schema version — no invocation record
   created; this is a malformed request, not an attempt.
2. Reject an `EVENT` where a `COMMAND` was expected.
3. Idempotency claim (§20, see below) — a repeat key short-circuits
   straight to the ORIGINAL invocation's outcome, never a second run.
4. Side-effect escalation check (§5, see above).
5. Execution authorization (§26) — `REQUESTED_ACTION`/`EXECUTION` levels
   require an injected `ExecutionAuthorizer` (structurally compatible
   with `GlobalExecutionGate` — `agent-core` cannot import `platform`,
   since `platform` already depends on `agent-core`, so this is a duck
   type a real `GlobalExecutionGate` instance satisfies by shape alone)
   to return `authorized: true` first. No agent reaches `execute()` for
   these levels otherwise — this is the mechanical guarantee behind "no
   agent may call a bookmaker integration directly, no agent may bypass
   the gate."
6. Persist `IDLE → RUNNING`, call `agent.execute()`, persist the outcome
   (`COMPLETED`, or `FAILED` with a disposition), audit via an optional
   injected `InvocationAuditSink` (structurally compatible with
   `AuditService`, same reasoning as `ExecutionAuthorizer`).

The pre-Section-06 direct call pattern (`gate.authorize()` →
`registry.execute()` → `audit.record()`, still exercised by
`tests/agents/execution-pipeline.test.ts`) remains valid for any caller
that doesn't need the orchestrator's idempotency/escalation/typed-failure
machinery — `AgentOrchestrator` is additive, not a replacement.

## Idempotency (§20)

`IdempotencyStore` (`packages/agent-core/src/idempotency.ts`) —
`claim(agentType, idempotencyKey, invocationId)` always returns the
WINNING record, whether that's the caller's own candidate (a fresh key)
or a pre-existing one (a repeat). `InMemoryIdempotencyStore` is
race-free by construction (no `await` between its read and write);
`@sport-os/agents`' `SupabaseIdempotencyStore` is backed by a real
database primary key on `(agent_type, idempotency_key)`
(`agent_idempotency_claims` — see
`supabase/migrations/*agent_idempotency_claims.sql`), so the guarantee
holds under genuine concurrent requests too — "use unique constraints...
do not rely solely on frontend checks."

## Registry

`InMemoryAgentRegistry` (`AgentService`) is a real, tested implementation
— pure bookkeeping (register/get/list/route), not business logic. A
persistent registry is a later-section concern if one is ever needed;
nothing about the interface presumes in-memory storage.

## Global Daily Risk Controller is not an agent

`AgentType.GLOBAL_DAILY_RISK_CONTROLLER` stays defined (a documented,
reservable identity) but deliberately has no `BaseAgent` implementation.
Section 06 §4 is explicit: "Global Daily Risk Controller is NOT an
unrestricted autonomous agent. It remains a centralized risk-control
service governed by the existing GlobalExecutionGate architecture. Do
not create a second independent global risk authority." The real
authority is `@sport-os/risk-engine`'s `GlobalDailyRiskController` — a
single, shared, process-wide instance. `@sport-os/agents`' Aviator Risk
Agent is constructed with that SAME instance (injected, never its own)
and only ever reads its state (`getState()`/`isExecutionAllowed()`/
`getCumulativePnL()`); it never constructs a controller and never calls
`recordResult()`. See `packages/agents/src/aviator/risk-agent.test.ts`'s
"two agent instances sharing the SAME controller" test for the proof
there is exactly one ledger.
