-- Section 06 — Agent Framework + Specialized Agents. Enum types mirroring
-- @sport-os/agent-core's TypeScript unions exactly (AgentType,
-- InvocationStatus, FailureDisposition, SideEffectLevel, MessageKind) —
-- see packages/agent-core/src/{types,invocation,capabilities,messages}.ts.
-- Kept as a database-level mirror the same way Section 05's
-- model_family/calibrator_type/... enums mirror their own TS unions:
-- defense in depth, not the single source of truth (the TypeScript types
-- are).

create type public.agent_type as enum (
  'football_intelligence', 'football_decision', 'football_automation',
  'telegram_channel_management', 'settlement', 'weekly_report',
  'aviator_intelligence', 'aviator_risk', 'aviator_automation',
  'global_daily_risk_controller', 'performance'
);

create type public.agent_invocation_status as enum (
  'idle', 'running', 'waiting', 'completed', 'failed', 'cancelled'
);

create type public.agent_failure_disposition as enum (
  'retryable_failure', 'permanent_failure'
);

create type public.agent_side_effect_level as enum (
  'read_only', 'analysis', 'proposal', 'requested_action', 'execution'
);

create type public.agent_message_kind as enum ('command', 'event');

-- Mirrors AgentFailureCode in packages/agent-core/src/failures.ts.
create type public.agent_failure_code as enum (
  'VALIDATION_ERROR', 'AUTHORIZATION_ERROR', 'ENTITLEMENT_ERROR',
  'DATA_UNAVAILABLE', 'DATA_QUALITY_ERROR', 'LEAKAGE_ERROR', 'MODEL_ERROR',
  'POLICY_REJECTED', 'RISK_REJECTED', 'INTEGRATION_UNAVAILABLE',
  'EXECUTION_REJECTED', 'TIMEOUT', 'CONFLICT', 'ALREADY_PROCESSED',
  'INTERNAL_ERROR'
);
