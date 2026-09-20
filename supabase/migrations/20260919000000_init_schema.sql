-- =============================================================================
-- TIPSTAR — SECTION 01 INITIAL SCHEMA
-- =============================================================================
-- Establishes the foundational relational schema described in
-- docs/architecture/database.md. Every later section extends this schema
-- with additional migrations — never edits this file after it has shipped.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type user_status as enum ('active', 'suspended', 'banned', 'deleted');
create type user_role as enum ('user', 'premium_user', 'partner_user', 'moderator', 'analyst', 'admin', 'super_admin');
create type sport as enum ('football', 'basketball', 'virtual_football', 'aviator');
create type event_status as enum ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'abandoned');
create type agent_type as enum ('football_agent', 'basketball_agent', 'virtual_football_agent', 'aviator_agent');
create type intelligence_result_status as enum ('generated', 'insufficient_data', 'error');
create type decision_status as enum ('qualified', 'wait', 'no_trade', 'monitor', 'rejected', 'insufficient_data');
create type final_result as enum ('win', 'loss', 'void', 'push', 'pending');
create type settlement_status as enum ('unsettled', 'settled', 'cancelled');
create type entitlement_source as enum ('partner_affiliate', 'direct_subscription', 'none');
create type subscription_status as enum ('active', 'trialing', 'past_due', 'cancelled', 'expired');

-- -----------------------------------------------------------------------------
-- Auth helper: reads the internal Tipstar user id from the request JWT.
-- The backend issues this claim only after validating Telegram initData
-- server-side (@tipstar/telegram) — RLS policies below rely on it instead
-- of ever trusting a client-supplied user id directly.
-- -----------------------------------------------------------------------------
create or replace function tipstar_auth_user_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'tipstar_user_id', '')::uuid
$$;

-- -----------------------------------------------------------------------------
-- Users & identity
-- -----------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  status user_status not null default 'active',
  language_code text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role user_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table telegram_identities (
  user_id uuid primary key references users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_username text,
  first_name text,
  last_name text,
  is_premium boolean,
  linked_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  pick_alerts boolean not null default true,
  result_alerts boolean not null default true,
  subscription_alerts boolean not null default true,
  marketing_messages boolean not null default false
);

create table user_sport_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sport sport not null,
  league_id uuid,
  team_id uuid,
  unique (user_id, sport, league_id, team_id)
);

-- -----------------------------------------------------------------------------
-- Sports data layer (provider-agnostic — see @tipstar/sports)
-- -----------------------------------------------------------------------------
create table leagues (
  id uuid primary key default gen_random_uuid(),
  sport sport not null,
  name text not null,
  country text,
  provider_id text not null,
  provider_event_id text not null,
  unique (provider_id, provider_event_id)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  logo_url text,
  provider_id text not null,
  provider_event_id text not null,
  unique (provider_id, provider_event_id)
);

create table sport_events (
  id uuid primary key default gen_random_uuid(),
  sport sport not null,
  league_id uuid references leagues(id),
  home_team_id uuid references teams(id),
  away_team_id uuid references teams(id),
  round_number int,
  scheduled_at timestamptz not null,
  status event_status not null default 'scheduled',
  provider_id text not null,
  provider_event_id text not null,
  raw jsonb,
  unique (provider_id, provider_event_id)
);

create index idx_sport_events_status on sport_events (status);
create index idx_sport_events_scheduled_at on sport_events (scheduled_at);

-- -----------------------------------------------------------------------------
-- Intelligence layer
-- -----------------------------------------------------------------------------
create table intelligence_results (
  id uuid primary key default gen_random_uuid(),
  agent_type agent_type not null,
  sport sport not null,
  event_id uuid not null references sport_events(id),
  market text not null,
  selection text not null,
  probability numeric,
  fair_odds numeric,
  market_odds numeric,
  expected_value numeric,
  confidence numeric,
  risk_score numeric,
  evidence jsonb not null default '[]'::jsonb,
  model_version text not null,
  generated_at timestamptz not null default now(),
  status intelligence_result_status not null,
  is_mock boolean not null default false
);

create index idx_intelligence_results_event_id on intelligence_results (event_id);
create index idx_intelligence_results_agent_type on intelligence_results (agent_type);

create table decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  intelligence_result_id uuid not null references intelligence_results(id),
  status decision_status not null,
  reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  decision_engine_version text not null
);

create index idx_decision_outcomes_result_id on decision_outcomes (intelligence_result_id);

-- -----------------------------------------------------------------------------
-- Pick Engine (immutable published picks — see Engineering Constitution T)
-- -----------------------------------------------------------------------------
create table picks (
  id uuid primary key default gen_random_uuid(),
  source_intelligence_result_id uuid not null unique references intelligence_results(id),
  agent_type agent_type not null,
  sport sport not null,
  league_id uuid references leagues(id),
  event_id uuid not null references sport_events(id),
  event_name text not null,
  market text not null,
  selection text not null,
  published_at timestamptz not null default now(),
  odds_at_publication numeric,
  probability numeric,
  fair_odds numeric,
  expected_value numeric,
  confidence numeric,
  risk_score numeric,
  model_version text not null,
  evidence jsonb not null default '[]'::jsonb,
  decision_status decision_status not null,
  final_result final_result not null default 'pending',
  settlement_status settlement_status not null default 'unsettled',
  settled_at timestamptz
);

create index idx_picks_event_id on picks (event_id);
create index idx_picks_sport on picks (sport);
create index idx_picks_agent_type on picks (agent_type);
create index idx_picks_settlement_status on picks (settlement_status);
create index idx_picks_published_at on picks (published_at);

-- Enforces immutability of core identity fields. Corrections must go
-- through the pick_corrections audit trail (application layer), and
-- settlement may only move settlement_status forward (never back to
-- 'unsettled') — see @tipstar/settlement's idempotency guarantee.
create or replace function enforce_pick_immutability() returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
    or new.source_intelligence_result_id <> old.source_intelligence_result_id
    or new.event_id <> old.event_id
    or new.agent_type <> old.agent_type
    or new.sport <> old.sport
    or new.market <> old.market
    or new.selection <> old.selection
    or new.published_at <> old.published_at
  then
    raise exception 'Pick identity fields are immutable; use a correction record instead.';
  end if;

  if old.settlement_status = 'settled' and new.settlement_status = 'unsettled' then
    raise exception 'A settled pick cannot be reverted to unsettled.';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_pick_immutability
  before update on picks
  for each row execute function enforce_pick_immutability();

create table pick_corrections (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references picks(id),
  field text not null,
  original_value text not null,
  corrected_value text not null,
  changed_by uuid not null references users(id),
  reason text not null,
  corrected_at timestamptz not null default now()
);

create index idx_pick_corrections_pick_id on pick_corrections (pick_id);

-- pick_corrections and audit_log are append-only ledgers.
create or replace function forbid_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only and cannot be updated or deleted', TG_TABLE_NAME;
end;
$$;

create trigger trg_pick_corrections_append_only
  before update or delete on pick_corrections
  for each row execute function forbid_mutation();

-- -----------------------------------------------------------------------------
-- Monetization: subscriptions (Path B) & affiliates (Path A)
-- -----------------------------------------------------------------------------
create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_period_days int not null,
  price_cents int not null,
  currency text not null default 'USD'
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id uuid not null references subscription_plans(id),
  status subscription_status not null,
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancelled_at timestamptz,
  payment_provider_id text not null,
  payment_provider_subscription_id text,
  unique (payment_provider_id, payment_provider_subscription_id)
);

create index idx_subscriptions_user_id on subscriptions (user_id);

create table affiliate_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table referral_attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  partner_id uuid not null references affiliate_partners(id),
  referral_code text not null,
  campaign text,
  attributed_at timestamptz not null default now(),
  converted_at timestamptz,
  unique (user_id, partner_id)
);

create index idx_referral_attributions_user_id on referral_attributions (user_id);

-- -----------------------------------------------------------------------------
-- Observability: append-only audit log
-- -----------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_user_id uuid references users(id),
  target_type text,
  target_id text,
  context jsonb not null default '{}'::jsonb,
  correlation_id text,
  occurred_at timestamptz not null default now()
);

create index idx_audit_log_occurred_at on audit_log (occurred_at);
create index idx_audit_log_action on audit_log (action);

create trigger trg_audit_log_append_only
  before update or delete on audit_log
  for each row execute function forbid_mutation();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table users enable row level security;
alter table user_roles enable row level security;
alter table telegram_identities enable row level security;
alter table notification_preferences enable row level security;
alter table user_sport_preferences enable row level security;
alter table subscriptions enable row level security;
alter table referral_attributions enable row level security;
alter table picks enable row level security;
alter table pick_corrections enable row level security;
alter table intelligence_results enable row level security;
alter table decision_outcomes enable row level security;
alter table audit_log enable row level security;

-- Users may read/update only their own row. All writes still go through
-- the backend (service role), which is the only way to change `status`
-- or roles — this policy exists for direct client reads of one's own profile.
create policy users_select_own on users for select using (id = tipstar_auth_user_id());
create policy users_update_own on users for update using (id = tipstar_auth_user_id());

create policy user_roles_select_own on user_roles for select using (user_id = tipstar_auth_user_id());

create policy telegram_identities_select_own on telegram_identities for select using (user_id = tipstar_auth_user_id());

create policy notification_preferences_select_own on notification_preferences for select using (user_id = tipstar_auth_user_id());
create policy notification_preferences_update_own on notification_preferences for update using (user_id = tipstar_auth_user_id());

create policy user_sport_preferences_all_own on user_sport_preferences for all
  using (user_id = tipstar_auth_user_id())
  with check (user_id = tipstar_auth_user_id());

create policy subscriptions_select_own on subscriptions for select using (user_id = tipstar_auth_user_id());

create policy referral_attributions_select_own on referral_attributions for select using (user_id = tipstar_auth_user_id());

-- Picks are the core public product: published picks are readable by
-- anyone (entitlement/paywall gating happens in the API layer, not RLS),
-- but only the service role may ever write one — clients never publish
-- or settle picks directly.
create policy picks_select_all on picks for select using (true);
create policy pick_corrections_select_all on pick_corrections for select using (true);

-- Intelligence internals and decision reasoning are not exposed to the
-- generic client — no select policy is defined, so only the service role
-- (which bypasses RLS) can read these tables. A future analyst-facing
-- admin API may add a scoped policy keyed off user_roles.
-- (Intentionally no policies here for intelligence_results / decision_outcomes / audit_log.)
