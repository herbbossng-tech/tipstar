-- public.settlements / public.settlement_legs (Section 08 §7/§10/§13 —
-- Settlement Inputs / Market Settlement / Accumulator Settlement).
--
-- One row per real `TicketSettlement` (`@sport-os/football-engine/
-- settlement.ts`'s `settleTicket()` output) — append-only, matching
-- "historical settlement decisions must remain auditable" (§6) and
-- "do not mutate historical... settlement result" (§49). A corrected
-- outcome is NEVER an UPDATE here — see `settlement_revisions.sql`.
--
-- Money fields are stored as an (amount, currency) pair per field,
-- mirroring `@sport-os/settlement-engine`'s `Money` type exactly — never
-- a bare numeric column that would silently lose currency information
-- (§44). `actual_*` pairs are both-null together (an unexecuted ticket
-- has no actual financial fields at all — §15/§42); `calculated_return`
-- is a clearly separate, labeled-estimate pair, never conflated with the
-- actual ones (§14/§16).

create table public.settlements (
  id uuid primary key,
  ticket_id uuid not null references public.tickets(id),
  ticket_version integer not null,
  status public.settlement_status not null,
  settlement_policy_version text not null,
  ledger_mode public.ledger_mode not null,
  actual_stake_amount numeric null,
  actual_stake_currency text null,
  actual_payout_amount numeric null,
  actual_payout_currency text null,
  payout_source public.payout_source null,
  calculated_return_amount numeric null,
  calculated_return_currency text null,
  net_pnl_amount numeric null,
  net_pnl_currency text null,
  roi numeric null,
  settled_at timestamptz null,
  source text not null,
  correlation_id text null,
  created_at timestamptz not null default now(),
  -- Every money field is an (amount, currency) PAIR — never one without the other (§44's "never silently convert/drop currency").
  check ((actual_stake_amount is null) = (actual_stake_currency is null)),
  check ((actual_payout_amount is null) = (actual_payout_currency is null)),
  check ((calculated_return_amount is null) = (calculated_return_currency is null)),
  check ((net_pnl_amount is null) = (net_pnl_currency is null)),
  -- actual_payout is only ever populated alongside a real PROVIDER source (§12 — never a CALCULATED figure masquerading as actual).
  check ((actual_payout_amount is null) or (payout_source = 'PROVIDER')),
  -- Idempotent settlement (§40): the SAME ticket version, under the SAME
  -- settlement policy, may only ever produce ONE settlement row — a real
  -- database constraint, not merely an application-level check.
  unique (ticket_id, ticket_version, settlement_policy_version)
);

comment on table public.settlements is
  'Append-only settlement records (Section 08) — one row per (ticket_id, ticket_version, settlement_policy_version). Never UPDATEd; a corrected outcome is a new settlement_revisions row, never a rewritten settlements row.';

create index settlements_ticket_id_idx on public.settlements (ticket_id);
create index settlements_status_idx on public.settlements (status);
create index settlements_ledger_mode_idx on public.settlements (ledger_mode);

alter table public.settlements enable row level security;

create table public.settlement_legs (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  leg_id uuid not null references public.ticket_legs(id),
  fixture_id uuid not null references public.fixtures(id),
  market_type text not null,
  selection text not null,
  line numeric null,
  odds numeric not null check (odds > 1),
  status public.settlement_status not null,
  -- The exact football MatchResult VERSION this leg was graded against
  -- (§7/§8 — "the exact result version used for settlement must be
  -- recorded"); null only when the leg is still PENDING (no result yet).
  result_version_id uuid null references public.match_results(id),
  reason text not null,
  created_at timestamptz not null default now(),
  check ((status = 'PENDING') or (result_version_id is not null))
);

comment on table public.settlement_legs is
  'Insert-only per-leg settlement detail (Section 08) — a 5-leg accumulator settlement has 5 rows here under ONE settlements row (§13/§24), never 5 separate settlements.';

create index settlement_legs_settlement_id_idx on public.settlement_legs (settlement_id);
create index settlement_legs_fixture_id_idx on public.settlement_legs (fixture_id);

alter table public.settlement_legs enable row level security;
