-- public.license_entitlements — Section 03 Entitlement Model.
--
-- feature_key is restricted to the locked set of feature keys already
-- named by Section 01's @sport-os/platform `Entitlement` const — the
-- CHECK constraint below is the database-level enforcement of "do not
-- silently add arbitrary entitlement names."

create table public.license_entitlements (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'football_analysis',
    'football_tickets',
    'football_automation',
    'aviator_analysis',
    'aviator_automation',
    'telegram_auto_publish',
    'telegram_multi_channel',
    'weekly_reports',
    'advanced_analytics'
  )),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (license_id, feature_key)
);

comment on table public.license_entitlements is
  'Feature flags scoped to a single license. A missing row for a feature_key means "not entitled" — see DATABASE_AND_RLS.md for how services must interpret an absent row vs. enabled = false (they are treated identically: not entitled).';

-- license_id already has an implicit index from the UNIQUE (license_id, feature_key) constraint.
create index license_entitlements_feature_key_idx on public.license_entitlements (feature_key);

alter table public.license_entitlements enable row level security;

create trigger set_license_entitlements_updated_at
before update on public.license_entitlements
for each row execute function public.set_updated_at();
