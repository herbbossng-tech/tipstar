-- public.licenses — Section 03 License Model.
--
-- License history is preserved: expiring/revoking a license never
-- deletes it (see "LICENSE UNIQUENESS / ACTIVE LICENSE RULE"). Only one
-- currently trial/active license per user is allowed at the database
-- level, enforced by the partial unique index below — this is the
-- concrete decision for the section's "Recommended architecture: allow
-- license history; only one currently active/trial license should
-- normally be valid for a user at a time."

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  license_key text not null unique,
  plan text not null,
  status public.license_status not null,
  starts_at timestamptz not null,
  expires_at timestamptz null,
  max_devices integer null,
  created_by uuid null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null
);

comment on table public.licenses is
  'License history for a user. Never delete a row here on expiry/revocation — see licenses.status and revoked_at instead. license_key is sensitive: see DATABASE_AND_RLS.md for exactly which columns are exposed to the authenticated role.';
comment on column public.licenses.license_key is
  'Sensitive. Never granted to the authenticated Postgres role (see RLS policies migration) — only service-role server code may read it, and only when it has a genuine reason to.';

create index licenses_user_id_idx on public.licenses (user_id);
create index licenses_status_idx on public.licenses (status);
create index licenses_expires_at_idx on public.licenses (expires_at);

-- Only one TRIAL or ACTIVE license may exist per user at a time.
-- SUSPENDED/EXPIRED/REVOKED licenses are historical and excluded, so a
-- user can accumulate any number of those without conflict.
create unique index licenses_one_active_per_user_idx
  on public.licenses (user_id)
  where status in ('trial', 'active');

alter table public.licenses enable row level security;

create trigger set_licenses_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();
