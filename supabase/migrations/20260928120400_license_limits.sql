-- public.license_limits — Section 03 Limit Model.
--
-- Limits are distinct from entitlements: a feature may be enabled but
-- still constrained by a limit. Exactly one limits row per license
-- (enforced by the UNIQUE constraint below) — this is a deliberate
-- tightening beyond the spec's suggested fields, chosen because multiple
-- competing limit rows per license would make "the current limit" an
-- ambiguous question. A NULL value on any individual limit column means
-- "no configured limit for this feature" (see DATABASE_AND_RLS.md) — this
-- section does not implement usage counters, only the typed limit
-- contract itself.

create table public.license_limits (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade unique,
  max_destinations integer null,
  max_tickets_per_day integer null,
  max_analysis_requests_per_day integer null,
  max_aviator_signals_per_day integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.license_limits is
  'At most one row per license (UNIQUE license_id). NULL on any limit column means "no configured limit" for that feature — never interpreted as zero.';

-- license_id already has an implicit unique index from the UNIQUE constraint above.

alter table public.license_limits enable row level security;

create trigger set_license_limits_updated_at
before update on public.license_limits
for each row execute function public.set_updated_at();
