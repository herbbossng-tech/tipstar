-- public.users — application-level identity record corresponding to a
-- verified Telegram identity (Section 03 — Core Identity Model).
--
-- telegram_user_id is the identity anchor (Section 01/02 already locked
-- this: see @sport-os/platform's Identity comment). Telegram username is
-- NOT the identity anchor and is deliberately not unique — it can change
-- and Telegram allows a user to have none.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username text null,
  first_name text not null,
  last_name text null,
  language_code text null,
  is_premium boolean not null default false,
  role public.user_role not null default 'user',
  status public.user_status not null default 'active',
  last_authenticated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Application identity anchored to a verified Telegram user. Created/updated only via upsertAuthenticatedTelegramUser() from a server-side-validated identity — never from client-supplied role/status.';
comment on column public.users.telegram_user_id is
  'Identity anchor. Not a secret — safe to read in the frontend for the owning user.';

-- users.telegram_user_id already has an implicit unique index from the
-- UNIQUE constraint above; not duplicated here.
create index users_role_idx on public.users (role);
create index users_status_idx on public.users (status);

alter table public.users enable row level security;

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();
