-- RLS identity/role helper functions (Section 03 — RLS Identity Helper /
-- Role Checking).
--
-- current_app_user_id() wraps Supabase's own auth.uid() (reads the `sub`
-- claim of the request's verified JWT — standard, documented Supabase
-- behavior). It is SECURITY INVOKER: it adds nothing auth.uid() doesn't
-- already provide, so it runs with the caller's own privileges.
--
-- current_app_role() / is_owner() / is_admin() look up the caller's row
-- in public.users. They are SECURITY DEFINER specifically to avoid RLS
-- self-reference edge cases on the users table (a policy that calls
-- is_admin() to decide visibility of OTHER users' rows must not have its
-- own lookup blocked by that same policy) — this is the sanctioned,
-- narrowly-scoped use case the spec's SECURITY DEFINER rules describe,
-- not a general-purpose escape hatch. Each:
--   - has an explicit search_path (prevents search_path hijacking)
--   - takes no caller-supplied input at all (nothing to validate/inject)
--   - reads exactly one row, matched only by auth.uid()
--   - is owned by the migration-running role (never a client-controllable role)
--
-- IMPORTANT — no bridge exists yet from Telegram identity to a Supabase
-- Auth JWT (see docs/architecture/AUTHORIZATION.md's "RLS integration
-- boundary"). auth.uid() is therefore NULL for every request today, and
-- these functions correctly deny access by default until that bridge is
-- built. That is a deliberate, documented gap, not an oversight — see
-- OPEN_QUESTIONS.md.

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select auth.uid();
$$;

create or replace function public.current_app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role from public.users where id = auth.uid()) = 'owner', false);
$$;

-- True for OWNER as well as ADMIN — an owner also holds administrative
-- authority. Use is_owner() for owner-exclusive checks.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role from public.users where id = auth.uid()) in ('owner', 'admin'), false);
$$;

revoke execute on function public.current_app_user_id() from public;
revoke execute on function public.current_app_role() from public;
revoke execute on function public.is_owner() from public;
revoke execute on function public.is_admin() from public;

grant execute on function public.current_app_user_id() to anon, authenticated, service_role;
grant execute on function public.current_app_role() to anon, authenticated, service_role;
grant execute on function public.is_owner() to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
