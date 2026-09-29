-- public.upsert_fixture_with_status_observation (PR review fix — Atomic
-- Fixture Upsert). The application-layer flow previously performed the
-- fixtures upsert and the fixture_status_observations insert as two
-- separate round-trips: if the first committed and the second failed,
-- the mutable "current state" row would change with no corresponding
-- entry in the append-only history that makes it point-in-time
-- reconstructable — silently reintroducing a narrower version of the
-- Mutable Fixture Status Leakage bug this section already fixed once.
--
-- This function performs both writes inside a single PL/pgSQL function
-- body, which executes within the caller's transaction: any exception
-- anywhere in the function (including a failed
-- fixture_status_observations insert) aborts the WHOLE transaction,
-- rolling back the fixtures write too. There is no code path where the
-- fixture mutates without its observation, or vice versa.
--
-- Fixture identity immutability (PR review fix — item 3): competition_id
-- /season_id/home_team_id/away_team_id and scheduled_kickoff_at are
-- deliberately absent from the `on conflict ... do update set` clause
-- below — a repeat sighting can never rewrite them here, regardless of
-- what the caller passes. This enforces, at the database layer, the
-- same invariant `ingestion.ts` enforces at the application layer
-- (quarantining a raw record whose identity fields disagree with the
-- fixture already on file) — belt and suspenders, per
-- FOOTBALL_DATA_ARCHITECTURE.md's "Fixture identity immutability"
-- section.
--
-- Concurrency: `insert ... on conflict (provider, provider_fixture_id)
-- do update` is Postgres's own atomic upsert primitive — two concurrent
-- first-sightings of the same fixture cannot both succeed as inserts;
-- the loser blocks on the unique index until the winner commits, then
-- applies as an update. The `old_state` CTE captures the pre-write
-- status/provider_status_raw/actual_kickoff_at (as of the start of this
-- statement) so the function can tell whether this write actually
-- changed anything worth recording as a new observation.
--
-- Deliberately NOT security definer, matching public.claim_owner_bootstrap
-- (Section 03's owner-bootstrap fix) and for the identical reason: only
-- service_role may call this (EXECUTE is revoked from PUBLIC below), and
-- service_role already has `bypassrls` and a blanket `grant all` on both
-- tables involved (see the football RLS policies migration) — no
-- privilege elevation is needed, and staying security invoker keeps
-- current_user intact for any future trigger that might rely on it, per
-- the lesson documented in 20260928120850_users_self_service_guard.sql.

create or replace function public.upsert_fixture_with_status_observation(
  p_competition_id uuid,
  p_season_id uuid,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_scheduled_kickoff_at timestamptz,
  p_status public.match_status,
  p_provider_status_raw text,
  p_provider text,
  p_provider_fixture_id text,
  p_observed_at timestamptz
)
returns public.fixtures
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_status public.match_status;
  v_old_provider_status_raw text;
  v_old_actual_kickoff_at timestamptz;
  v_existed boolean := false;
  v_fixture public.fixtures;
begin
  if p_home_team_id = p_away_team_id then
    raise exception 'Fixture must have two distinct teams.' using errcode = '23514';
  end if;

  -- Captures the pre-write state (if any) and locks the row for the
  -- duration of this transaction when it already exists, so a
  -- concurrent call for the SAME fixture serializes against this one
  -- rather than racing on what "changed" means.
  select status, provider_status_raw, actual_kickoff_at
    into v_old_status, v_old_provider_status_raw, v_old_actual_kickoff_at
    from public.fixtures
    where provider = p_provider and provider_fixture_id = p_provider_fixture_id
    for update;
  v_existed := found;

  insert into public.fixtures (
    competition_id, season_id, home_team_id, away_team_id,
    scheduled_kickoff_at, status, provider_status_raw, provider, provider_fixture_id
  ) values (
    p_competition_id, p_season_id, p_home_team_id, p_away_team_id,
    p_scheduled_kickoff_at, p_status, p_provider_status_raw, p_provider, p_provider_fixture_id
  )
  on conflict (provider, provider_fixture_id) do update
    set status = excluded.status,
        provider_status_raw = excluded.provider_status_raw
    -- competition_id/season_id/home_team_id/away_team_id/
    -- scheduled_kickoff_at are deliberately NOT set here — see the
    -- immutability comment above.
  returning * into v_fixture;

  if not v_existed
     or v_old_status is distinct from v_fixture.status
     or v_old_provider_status_raw is distinct from v_fixture.provider_status_raw
     or v_old_actual_kickoff_at is distinct from v_fixture.actual_kickoff_at
  then
    insert into public.fixture_status_observations (
      fixture_id, status, provider_status_raw, actual_kickoff_at, observed_at, provider
    ) values (
      v_fixture.id, v_fixture.status, v_fixture.provider_status_raw, v_fixture.actual_kickoff_at, p_observed_at, p_provider
    );
  end if;

  return v_fixture;
end;
$$;

comment on function public.upsert_fixture_with_status_observation(uuid, uuid, uuid, uuid, timestamptz, public.match_status, text, text, text, timestamptz) is
  'Atomically upserts a fixture''s current state and, when status/provider_status_raw/actual_kickoff_at actually changed (or this is the first sighting), records the corresponding fixture_status_observations row — one coherent operation, never a state where one commits without the other. service_role only.';

revoke execute on function public.upsert_fixture_with_status_observation(uuid, uuid, uuid, uuid, timestamptz, public.match_status, text, text, text, timestamptz) from public;
grant execute on function public.upsert_fixture_with_status_observation(uuid, uuid, uuid, uuid, timestamptz, public.match_status, text, text, text, timestamptz) to service_role;
