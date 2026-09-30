-- public.settlement_revisions (Section 08 §6/§9 — Settlement State
-- Machine / Result Corrections). "Do NOT allow WON -> LOST or LOST ->
-- WON through ordinary mutation. Corrections MUST use an explicit
-- settlement revision/correction mechanism... never destroy the
-- historical record." The ONLY way a settlement's effective outcome
-- ever changes after the fact — `settlements` rows are never UPDATEd
-- for this purpose (see `settlements.sql`'s own comment).
--
-- The currently-effective status/payout for a settlement is resolved by
-- folding this table's rows (ordered by `created_at`) on top of the
-- original `settlements` row — see `@sport-os/settlement-engine`'s
-- `resolveCurrentSettlement()`, the exact function this table's shape
-- mirrors.

create table public.settlement_revisions (
  id uuid primary key,
  original_settlement_id uuid not null references public.settlements(id),
  previous_status public.settlement_status not null,
  new_status public.settlement_status not null,
  previous_payout_amount numeric null,
  previous_payout_currency text null,
  new_payout_amount numeric null,
  new_payout_currency text null,
  reason text not null,
  source text not null,
  result_version_id uuid null references public.match_results(id),
  -- Idempotent corrections (§41 adversarial test #12 — "same result
  -- correction submitted twice: expected no duplicate financial
  -- effect"): the caller supplies a deterministic key (e.g.
  -- `${originalSettlementId}:${resultVersionId}`); a real unique
  -- constraint, not merely an application-level check.
  idempotency_key text null,
  created_at timestamptz not null default now(),
  created_by text not null,
  check ((previous_payout_amount is null) = (previous_payout_currency is null)),
  check ((new_payout_amount is null) = (new_payout_currency is null))
);

comment on table public.settlement_revisions is
  'Append-only settlement corrections (Section 08) — never UPDATEd or DELETEd. Multiple revisions for the same original_settlement_id are expected and fully preserved; the LATEST by created_at is the currently-effective one.';

create unique index settlement_revisions_idempotency_key_idx on public.settlement_revisions (idempotency_key) where idempotency_key is not null;
create index settlement_revisions_original_settlement_id_idx on public.settlement_revisions (original_settlement_id, created_at);

alter table public.settlement_revisions enable row level security;
