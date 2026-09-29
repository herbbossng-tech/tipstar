-- Section 03 — Supabase Database + RLS + Roles + Licensing
--
-- Enum types and the shared updated_at trigger function used by every
-- table this section creates.
--
-- Enum values are lowercase to match the runtime string values already
-- locked by Section 01's TypeScript contracts (@sport-os/platform's
-- `Role`, `LicenseStatus`, `Entitlement`) — see
-- docs/architecture/DATABASE_AND_RLS.md for why this casing was chosen
-- over the Master Blueprint prose's uppercase spelling.

create type public.user_role as enum ('owner', 'admin', 'user');

create type public.user_status as enum ('active', 'suspended', 'disabled');

create type public.license_status as enum ('trial', 'active', 'suspended', 'expired', 'revoked');

-- Reusable updated_at maintenance: every UPDATE recomputes updated_at
-- server-side, so a client can never spoof it (see "UPDATED_AT" in the
-- Section 03 spec). SECURITY INVOKER (the default) is correct here — this
-- trigger only touches the row already being written by the invoking
-- statement, under that statement's own privileges.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
