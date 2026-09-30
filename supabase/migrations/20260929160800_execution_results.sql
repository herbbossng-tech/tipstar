-- public.execution_results (Section 07 §29 — Execution Result States).
-- Append-only status history for an `execution_requests` row — "only a
-- confirmed external result may be EXECUTED" (§Final Rule). A real
-- `ExecutionIntegration.execute()`/`status()` call is expected to INSERT
-- a NEW row here on every state transition it observes (REQUESTED ->
-- SUBMITTED -> ACCEPTED -> EXECUTED, or any FAILED/REJECTED/UNKNOWN
-- branch), never UPDATE a prior row — the current status for a request is
-- "the row with the greatest recorded_at for that execution_request_id".
-- No row in this table is ever inserted by anything other than a real
-- `ExecutionIntegration` response; nothing in this codebase fabricates
-- one (the only implementation, `NotImplementedExecutionIntegration`,
-- never reaches a point where it would insert here at all).

create table public.execution_results (
  id uuid primary key default gen_random_uuid(),
  execution_request_id uuid not null references public.execution_requests(id) on delete cascade,
  status public.execution_result_status not null,
  external_reference text null,
  stake numeric null check (stake is null or stake > 0),
  executed_at timestamptz null,
  recorded_at timestamptz not null default now()
);

comment on table public.execution_results is
  'Append-only execution status history (Section 07). Never UPDATEd — the current status for an execution_request is the row with the greatest recorded_at. Only a real ExecutionIntegration response may ever produce an EXECUTED row.';

create index execution_results_execution_request_id_idx on public.execution_results (execution_request_id, recorded_at);
create index execution_results_external_reference_idx on public.execution_results (external_reference) where external_reference is not null;

alter table public.execution_results enable row level security;
