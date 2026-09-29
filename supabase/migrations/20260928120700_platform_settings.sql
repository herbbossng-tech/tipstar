-- public.platform_settings — OWNER bootstrap tracking (Section 03 —
-- Owner Bootstrap). Singleton table: `id` is a boolean primary key
-- constrained to the literal value true, so at most one row can ever
-- exist (a standard Postgres "singleton table" pattern — not Supabase-
-- specific behavior).
--
-- No RLS policy is defined for any role here at all: only the
-- service-role Postgres role (which bypasses RLS entirely) may ever
-- read or write this table. This is intentional and matches the spec's
-- "service-role operations must be server-side only" — the owner
-- bootstrap secret comparison itself happens in application code (see
-- @sport-os/platform's bootstrapOwner()), never in SQL, so no secret is
-- ever stored in or compared by the database.

create table public.platform_settings (
  id boolean primary key default true,
  owner_bootstrapped_at timestamptz null,
  owner_bootstrapped_user_id uuid null references public.users(id),
  constraint platform_settings_singleton check (id)
);

comment on table public.platform_settings is
  'Singleton (exactly one row, id = true). owner_bootstrapped_at being non-null permanently disables the one-time OWNER bootstrap operation — see bootstrapOwner() in @sport-os/platform.';

insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;
