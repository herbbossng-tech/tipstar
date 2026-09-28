-- Guards role/status changes on public.users (Section 03 — Users RLS /
-- Role Checking).
--
-- Why a trigger and not just column-level GRANTs: Supabase's Postgres
-- roles are shared across every application-level role — `authenticated`
-- is the ONE Postgres role for every logged-in user regardless of
-- whether their `users.role` is 'user', 'admin', or 'owner'. A column
-- GRANT is per-Postgres-role, so it cannot express "admin may write
-- this column, user may not" — only a per-row check can. This trigger is
-- that check, layered on top of (not instead of) the RLS policy on
-- public.users and the column grants in the RLS policies migration.
--
-- Invariants enforced here:
--   - Nobody may change their OWN role or status through this path —
--     not even an OWNER. (Applied universally, not just to non-admins:
--     "Never allow an ADMIN to promote themselves" generalizes cleanly
--     to "no self-service role/status change, full stop.")
--   - Changing ANY OTHER user's role requires is_admin().
--   - Setting a row's role to OR away from 'owner' additionally requires
--     is_owner() — an ADMIN may never create or remove an OWNER.
--   - Changing ANY OTHER user's status requires is_admin().
--
-- service_role is exempted: service-role writes originate from
-- @sport-os/platform's typed admin operations (changeUserRole,
-- suspendUser, etc.), which perform their own authorization check
-- before issuing the UPDATE — that is the actual authorization boundary
-- for the service-role path, per "The application must enforce business
-- authorization." Without this exemption, is_admin()/is_owner() would
-- evaluate against auth.uid() = NULL for a service-role connection (no
-- request.jwt.claims is ever set on it) and incorrectly reject every
-- legitimate service-role role change.

create or replace function public.enforce_user_self_service_boundaries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role then
    if old.id = auth.uid() then
      raise exception 'Users may not change their own role.' using errcode = '42501';
    end if;
    if not public.is_admin() then
      raise exception 'Only an administrator may change a user''s role.' using errcode = '42501';
    end if;
    if (new.role = 'owner' or old.role = 'owner') and not public.is_owner() then
      raise exception 'Only an owner may create or remove an owner.' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.id = auth.uid() then
      raise exception 'Users may not change their own status.' using errcode = '42501';
    end if;
    if not public.is_admin() then
      raise exception 'Only an administrator may change a user''s status.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_user_self_service_boundaries
before update on public.users
for each row execute function public.enforce_user_self_service_boundaries();
