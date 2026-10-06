-- Section 13 — Fixture External Identity Reconciliation.
--
-- Sportmonks is the canonical football-data provider (Section 13
-- locked decision): every fixture's own identity row in public.fixtures
-- is keyed by (provider='sportmonks', provider_fixture_id). The Odds
-- API identifies the SAME real-world fixture with its own, unrelated
-- event id. This table is an explicit, auditable cross-reference from
-- a SECOND provider's own identifier to the ONE internal fixture row —
-- it never changes what public.fixtures itself considers a fixture's
-- identity (that remains locked to Sportmonks, unchanged).
--
-- A mapping row is only ever created after a confident, non-ambiguous
-- match (team names + kickoff time within a bounded window) — see
-- apps/worker's football-odds-ingestion job. An ambiguous match is
-- quarantined (public.data_quarantine), never inserted here as a guess.

create table public.fixture_external_identities (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  provider text not null,
  provider_fixture_id text not null,
  -- How the match was established — "team_name_kickoff_time" today;
  -- kept as free text rather than an enum since this is a diagnostic/
  -- audit field, not something application logic branches on.
  match_method text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_fixture_id)
);

comment on table public.fixture_external_identities is
  'Cross-reference from a non-canonical provider (e.g. the-odds-api) own fixture/event identifier to the one internal fixture row whose own identity is locked to the canonical provider (Sportmonks). Never used to change public.fixtures own identity.';

create index fixture_external_identities_fixture_id_idx on public.fixture_external_identities (fixture_id);

alter table public.fixture_external_identities enable row level security;

revoke all on public.fixture_external_identities from anon, authenticated;

grant select on public.fixture_external_identities to authenticated;
create policy fixture_external_identities_select_admin_only on public.fixture_external_identities for select using (public.is_admin());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated — reconciliation
-- is exclusively a service-role (worker) operation, same rule as every
-- other Section 04 ingestion-owned table.
grant all on public.fixture_external_identities to service_role;
