-- Atomic OWNER bootstrap claim (Section 03 fix — Owner Bootstrap Race
-- Condition). The prior application-layer flow (read
-- platform_settings.owner_bootstrapped_at -> promote the caller ->
-- write owner_bootstrapped_at -> write an audit row) used three
-- separate round-trips with no locking between them: two concurrent
-- valid bootstrap requests could both observe owner_bootstrapped_at IS
-- NULL and both proceed, violating "OWNER bootstrap is permanently
-- one-time." This function replaces that entire flow with a single,
-- atomic, server-side operation — the claim and the promotion happen
-- together, inside one transaction, with no read-then-write gap for a
-- second caller to land in.
--
-- Why this is race-safe: the UPDATE below acquires Postgres's row lock
-- on the platform_settings singleton row (id = true) the moment it
-- runs. A second, concurrent call attempting the same UPDATE blocks on
-- that lock until the first transaction commits (or rolls back); once
-- unblocked, it re-evaluates `owner_bootstrapped_at is null` against
-- the now-committed row and finds it false, so its own UPDATE matches
-- zero rows (`if not found`). Exactly one concurrent caller can ever
-- see the claim succeed. This is Postgres's standard idiomatic "claim"
-- pattern — a single conditional UPDATE, never a prior SELECT followed
-- by a separate UPDATE — and needs no additional advisory lock or
-- unique constraint layered on top of it.
--
-- Coherence: promoting the target user to OWNER happens inside the SAME
-- function invocation (== the same transaction) as the platform_settings
-- claim. If the user-role UPDATE fails or matches zero rows (e.g. the
-- caller passed a user id that does not exist — an integrity anomaly
-- that should be unreachable in practice, since the caller must already
-- have resolved a valid session to a real users row), the function
-- raises and the ENTIRE transaction rolls back, including the
-- platform_settings claim — so a failed promotion can never leave the
-- one-time slot permanently (and wrongly) consumed with nobody actually
-- promoted.
--
-- Deliberately NOT security definer. EXECUTE is revoked from PUBLIC and
-- granted ONLY to service_role, so an ordinary client (anon/
-- authenticated) can never invoke this at all — and the only role that
-- *can* call it (service_role) already has `bypassrls` and a blanket
-- `grant all` on these tables (see the RLS policies migration), so no
-- privilege elevation is needed here. Staying security invoker (the
-- default) matters for a subtler reason: this function's own UPDATE on
-- `users` fires enforce_user_self_service_boundaries(), whose
-- service_role exemption checks `current_user = 'service_role'`.
-- Entering a SECURITY DEFINER function always switches current_user to
-- that function's OWNER for its duration (a Postgres SECURITY DEFINER
-- semantic, not a bug) — so if THIS function were security definer, the
-- trigger would see current_user as this function's owner instead of
-- 'service_role' and incorrectly reject the promotion. Security invoker
-- lets current_user (established by the caller's own `SET ROLE
-- service_role`, exactly as PostgREST/Supabase do per request) flow
-- through unchanged. The bootstrap secret itself is still never stored
-- in or compared by the database — that comparison remains entirely in
-- application code (see @sport-os/platform's bootstrapOwner() and
-- supabase/functions/owner-bootstrap), server-side and timing-safe,
-- before this function is ever called.

create or replace function public.claim_owner_bootstrap(p_user_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.platform_settings
    set owner_bootstrapped_at = now(), owner_bootstrapped_user_id = p_user_id
    where id = true and owner_bootstrapped_at is null;

  if not found then
    -- Already claimed (by this or a prior/concurrent call). Nothing was
    -- mutated — a deterministic "already done" signal to the caller,
    -- never a race-prone re-check.
    return false;
  end if;

  update public.users set role = 'owner' where id = p_user_id;

  if not found then
    raise exception 'OWNER_BOOTSTRAP_TARGET_USER_NOT_FOUND';
  end if;

  return true;
end;
$$;

comment on function public.claim_owner_bootstrap(uuid) is
  'Atomically claims the one-time OWNER bootstrap slot and promotes p_user_id to OWNER as a single coherent operation. Returns true if THIS call performed the claim, false if it was already claimed. service_role only — application code must call this instead of any SELECT-then-UPDATE pattern.';

revoke execute on function public.claim_owner_bootstrap(uuid) from public;
grant execute on function public.claim_owner_bootstrap(uuid) to service_role;
