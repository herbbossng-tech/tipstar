-- public.decisions (Section 07 §10 — Decision Engine / Structured
-- Decision Reasons). The FINALIZED per-evaluation outcome — a
-- `value_evaluations` row, optionally combined with exactly one
-- `risk_evaluations` row via `applyRiskRejection()`, and optionally
-- attached to the `tickets` row it was folded into. Persisting this as
-- its own append-only table (rather than just reading `value_evaluations.
-- decision` directly) keeps the "layers must remain separate" rule
-- visible in the schema: a `decisions` row can only ever REFERENCE a
-- value evaluation and a risk evaluation, never overwrite or merge their
-- columns into itself.
--
-- "A ticket proposal is NOT an executed wager. Probability is NOT a
-- decision." — nothing in this table is ever produced by anything other
-- than `evaluateValue()`/`applyRiskRejection()`'s real outputs; no row
-- here is ever synthesized from a raw probability directly.

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  value_evaluation_id uuid not null references public.value_evaluations(id),
  risk_evaluation_id uuid null references public.risk_evaluations(id),
  ticket_id uuid null references public.tickets(id) on delete set null,
  outcome public.decision_outcome not null,
  reasons text[] not null default '{}',
  qualifies boolean not null,
  requested_by uuid null references public.users(id),
  decided_at timestamptz not null default now()
);

comment on table public.decisions is
  'Append-only finalized decisions (Section 07) — a value_evaluations row optionally combined with one risk_evaluations row via applyRiskRejection(). Never UPDATEd; a changed decision is a NEW row referencing a NEW value_evaluations/risk_evaluations pair.';

create index decisions_value_evaluation_id_idx on public.decisions (value_evaluation_id);
create index decisions_risk_evaluation_id_idx on public.decisions (risk_evaluation_id);
create index decisions_ticket_id_idx on public.decisions (ticket_id);
create index decisions_outcome_idx on public.decisions (outcome);

alter table public.decisions enable row level security;
