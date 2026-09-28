-- LOCAL TEST HARNESS ONLY — never applied to a real Supabase project
-- (which provides all of this natively). Reproduces the documented parts
-- of Supabase's Postgres environment that this repo's migrations depend
-- on, so RLS policies can be validated against a plain, locally-installed
-- Postgres 16 instance:
--   - the `anon`, `authenticated`, `service_role` roles
--   - `auth.uid()`, matching Supabase's own public implementation
--     (reads the `sub` claim from the `request.jwt.claims` session
--     setting — see https://github.com/supabase/auth and Supabase's RLS
--     docs).

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
