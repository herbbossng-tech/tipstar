-- Section 07 — Decision + Value + Ticket + Risk + Execution Gate. Enum
-- types mirroring the TypeScript `as const` unions this section
-- introduced exactly (defense-in-depth mirror, same rationale as
-- Section 06's agent_enums.sql — the TypeScript types remain the single
-- source of truth):
--   MarketStatus            @sport-os/market-engine/src/types.ts
--   TicketType/TicketStatus @sport-os/football-engine/src/ticket-engine.ts
--   DecisionOutcome         @sport-os/football-engine/src/decision.ts
--   FootballExecutionMode/AviatorExecutionMode (identical value sets)
--                            @sport-os/agents
--   ExecutionResultStatus   @sport-os/agents/src/execution-integration.ts
--
-- market_type/selection/eligibility/decision-reason-codes/risk-codes
-- remain plain text (never an enum here), following the precedent
-- already set by Section 04's odds_observations.market_type: these sets
-- are open-ended/application-validated, not small fixed states.

create type public.market_status as enum ('open', 'suspended', 'cancelled');

create type public.ticket_type as enum ('SINGLE', 'ACCUMULATOR');

create type public.ticket_status as enum (
  'DRAFT', 'PROPOSED', 'VALIDATED', 'AUTHORIZED', 'EXECUTING', 'EXECUTED', 'REJECTED', 'CANCELLED'
);

create type public.decision_outcome as enum (
  'BET', 'NO_EDGE', 'WAIT', 'NO_TRADE', 'INSUFFICIENT_DATA', 'MARKET_UNSUPPORTED', 'RISK_REJECTED'
);

-- Shared by FootballExecutionMode and AviatorExecutionMode — both are the
-- exact same three values (manual/assisted/automatic); one enum, not two.
create type public.execution_mode as enum ('manual', 'assisted', 'automatic');

create type public.execution_result_status as enum (
  'REQUESTED', 'AUTHORIZED', 'SUBMITTED', 'ACCEPTED', 'EXECUTED', 'REJECTED', 'FAILED', 'UNKNOWN', 'NOT_AVAILABLE', 'MANUAL_REQUIRED'
);
