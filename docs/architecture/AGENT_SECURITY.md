# Agent Security

Authorization, execution boundaries, and audit for the Section 06 agent
framework. See [`../agents/AGENT_CORE.md`](../agents/AGENT_CORE.md) for
the mechanics (`AgentOrchestrator`, `ExecutionAuthorizer`,
`SideEffectLevel`) this document explains the security rationale for.

## The gate is structural, not conventional

`AgentOrchestrator.dispatch()` requires a passing `ExecutionAuthorizer`
check (structurally compatible with `@sport-os/platform`'s real
`GlobalExecutionGate`) before it will call `agent.execute()` for any
message whose `sideEffectLevel` is `REQUESTED_ACTION` or `EXECUTION`.
This is not a convention agents are expected to follow — it is
mechanically impossible for a `COMMAND` at those levels to reach an
agent's `execute()` any other way through this framework:

- No `ExecutionAuthorizer` configured on the orchestrator at all →
  `INTEGRATION_UNAVAILABLE`, agent never called.
- `ExecutionAuthorizer.authorize()` returns `authorized: false` → a
  typed failure (`RISK_REJECTED`/`ENTITLEMENT_ERROR`/
  `AUTHORIZATION_ERROR`/`POLICY_REJECTED`, derived from the gate's own
  `failedCheck` name — `identity`/`license`/`entitlement`/`risk`/
  `integration_availability`, never guessed from free-form error text),
  agent never called.
- The dispatched `sideEffectLevel` exceeds the agent's own declared
  ceiling → `POLICY_REJECTED`, agent never called, regardless of what
  authorizer is configured.

No code in `@sport-os/agents` calls a bookmaker/execution integration
outside `AgentOrchestrator.dispatch()`'s EXECUTION path, and no code
constructs a second `GlobalExecutionGate`-shaped authorizer that always
approves. See `adversarial.test.ts`'s §33 tests #2, #3, #10 and §34 test
#4 for the adversarial proof.

## Why `ExecutionAuthorizer`/`InvocationAuditSink` are duck types

`@sport-os/agent-core` has zero dependency on `@sport-os/platform` —
`platform` already depends on `agent-core` (for `AgentType`/`Agent`/
`BaseAgent`), so the reverse import would be circular. `ExecutionAuthorizer`
and `InvocationAuditSink` in `orchestrator.ts` are structural
(TypeScript duck-typed) interfaces a real `GlobalExecutionGate`/
`AuditService` instance satisfies by shape alone — no adapter, no second
implementation of the actual authorization/audit logic. `@sport-os/agents`
wires the real instances in.

## Entitlements are declared, never re-implemented

Every `AgentDeclaration.requiredEntitlements` (see `AGENT_CONTRACTS.md`
for each agent's actual list) references `@sport-os/platform`'s real
`Entitlement` enum values — `football_analysis`, `football_tickets`,
`football_automation`, `aviator_analysis`, `aviator_automation`,
`telegram_auto_publish`, `weekly_reports`, `advanced_analytics`. No
agent contains its own entitlement-checking logic; the declaration is
metadata an `entitlement` `GateCheck` (constructed with a real
`LicenseService`) consults before authorizing. `agent-core` cannot
import the real `Entitlement` type either (same circular-dependency
reason as above), so `requiredEntitlements` is typed `readonly string[]`
in `agent-core`, and `@sport-os/agents` passes real `Entitlement` values
into it (a string enum member is assignable to `string[]` without a
cast).

## Human confirmation is an explicit flag, never inferred

Both automation agents (`FootballAutomationAgent`/`AviatorAutomationAgent`)
require `userConfirmed: boolean` as part of their input for `ASSISTED`
mode. This flag is trusted at face value — obtaining it honestly (a real
button press, not merely rendering a confirmation screen) is the
caller's (Mini App/bot) responsibility, entirely outside what an agent
can verify. `ASSISTED` mode with `userConfirmed: false` always returns
`CONFIRMATION_REQUIRED` and never touches the execution integration.

## Idempotency is a real database guarantee, not just an app-level check

`agent_invocations` has a unique index on `(agent_type, idempotency_key)`
(partial, `where idempotency_key is not null`), and
`agent_idempotency_claims` has a primary key on the same pair — see
`supabase/migrations/20260929150100_agent_invocations.sql` and
`20260929150200_agent_idempotency_claims.sql`. A duplicate execution or
publication command, even under genuine concurrent requests, resolves to
the SAME invocation, never a second one — `AgentOrchestrator.dispatch()`
never calls `agent.execute()` twice for the same `(agentType,
idempotencyKey)` pair. See `adversarial.test.ts`'s §33 tests #6/#7.

## What is logged, and what is never logged

Audit events (via the optional `InvocationAuditSink`) record: actor,
requested operation, resource (`agent_invocation`), outcome
(`success`/`failure`/`denied`), correlation id, agent type/id, and —
on failure/denial — the failure code and the gate's `failedCheck`/
`reason`. Never logged: passwords, secrets, Telegram `initData`,
authentication tokens, service credentials. `AgentExecutionContext`
(`packages/agent-core/src/context.ts`) structurally cannot carry any of
these — it has fields for `actorUserId`/`actorRole`/`telegramUserId`
(the numeric id only) and nothing resembling a credential; see its own
doc comment for why raw Telegram `initData` never enters the agent
framework at all.

## Database RLS

`agent_invocations`/`agent_messages` are admin-only `SELECT` for
`authenticated`, exactly like Section 05's internal ML-pipeline tables —
never broad `authenticated` access the way Section 04's content tables
are. `agent_idempotency_claims` is withheld even from admins (it carries
no content worth browsing, only concurrency-control state) —
`service_role` only. No `INSERT`/`UPDATE`/`DELETE` policy exists for
`anon`/`authenticated` on any of the three tables anywhere in
`supabase/migrations/20260929150400_agent_rls_policies.sql`; every write
happens through the service-role-backed
`SupabaseInvocationsRepository`/`SupabaseIdempotencyStore`/
`SupabaseAgentMessagesRepository` (`@sport-os/agents/db/repositories.ts`).
See `tests/database/80_agent_rls_cases.sql` for the full, verified
transcript.
