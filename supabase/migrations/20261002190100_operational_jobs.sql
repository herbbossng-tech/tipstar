-- public.operational_jobs (Section 11 §E/§AD). The durable job queue —
-- a simple, reliable Postgres-backed runner, not a distributed queue.
-- Mirrors `OperationalJobRecord`
-- (packages/platform/src/operations/jobs.ts) exactly.

create table public.operational_jobs (
  job_id uuid primary key default gen_random_uuid(),
  job_type public.operational_job_type not null,
  status public.operational_job_status not null default 'QUEUED',
  -- A REFERENCE (an id, a period string, a boolean flag) — never a
  -- secret or an arbitrary sensitive blob (§E: "do not store arbitrary
  -- sensitive payloads... store references rather than secrets").
  payload_reference jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null check (max_attempts >= 1),
  next_attempt_at timestamptz null,
  last_error text null,
  last_failure_category public.job_failure_category null,
  idempotency_key text not null,
  -- The real actor who caused this job to exist — a users.id, or the
  -- literal string 'system' for a scheduler-created job (§G). Never a
  -- foreign key to users: 'system' is a valid, non-UUID value here by
  -- design, and this column is NEVER read back as authorization proof
  -- (see job-worker.ts's own doc comment — a worker resolves its own
  -- authorization context independently, never from this field).
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only a terminal, no-further-transition status ever carries
  -- completed_at — FAILED is deliberately excluded: a FAILED job may
  -- still be retried (FAILED -> QUEUED, see isValidJobTransition), so
  -- it is not yet "completed" in the sense this column means.
  check ((completed_at is not null) = (status in ('SUCCEEDED', 'CANCELLED')))
);

comment on table public.operational_jobs is
  'Durable job queue (Section 11). Status transitions are validated in application code (isValidJobTransition) before ever reaching this table — the CHECK constraint here is a defense-in-depth mirror, not the primary enforcement. Claimed exclusively via claim_next_operational_job() — never a client-side SELECT-then-UPDATE.';

-- Idempotency (§AE): a repeat idempotencyKey must resolve to the SAME
-- job, never a new row.
create unique index operational_jobs_idempotency_key_idx on public.operational_jobs (idempotency_key);

create index operational_jobs_status_idx on public.operational_jobs (status);
create index operational_jobs_job_type_idx on public.operational_jobs (job_type);
create index operational_jobs_next_attempt_at_idx on public.operational_jobs (next_attempt_at);
create index operational_jobs_scheduled_at_idx on public.operational_jobs (scheduled_at);
create index operational_jobs_created_at_idx on public.operational_jobs (created_at);

alter table public.operational_jobs enable row level security;

-- Atomic claim (§E/§AD): "concurrent workers cannot execute the same
-- job simultaneously... a stale RUNNING job can be identified/recovered
-- according to a documented lease/timeout rule." Mirrors
-- claim_owner_bootstrap()'s own atomic-UPDATE pattern (Section 03), but
-- needs to pick ONE row out of potentially many eligible ones, so it
-- uses `FOR UPDATE SKIP LOCKED` to let concurrent callers each land on
-- a DIFFERENT eligible row instead of blocking on each other — the
-- standard Postgres "competing consumers" idiom.
--
-- Eligible = (QUEUED and due: next_attempt_at is null or <= p_now) OR
-- (RUNNING but its lease has expired: started_at < p_now - lease).
-- Deliberately NOT security definer, for the same reason
-- claim_owner_bootstrap() isn't — service_role already has the access
-- it needs; EXECUTE is restricted to service_role only below.
create or replace function public.claim_next_operational_job(p_job_type public.operational_job_type, p_now timestamptz, p_lease_timeout_ms integer)
returns public.operational_jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job public.operational_jobs;
begin
  select * into v_job
    from public.operational_jobs
    where job_type = p_job_type
      and (
        (status = 'QUEUED' and (next_attempt_at is null or next_attempt_at <= p_now))
        or (status = 'RUNNING' and started_at is not null and started_at < p_now - (p_lease_timeout_ms || ' milliseconds')::interval)
      )
    order by scheduled_at asc
    for update skip locked
    limit 1;

  if v_job.job_id is null then
    return null;
  end if;

  update public.operational_jobs
    set status = 'RUNNING', started_at = p_now, attempts = attempts + 1, updated_at = p_now
    where job_id = v_job.job_id
    returning * into v_job;

  return v_job;
end;
$$;

comment on function public.claim_next_operational_job(public.operational_job_type, timestamptz, integer) is
  'Atomically claims one eligible QUEUED-and-due or stale-RUNNING job of the given type and marks it RUNNING, bumping attempts. Returns null when none is eligible. service_role only.';

revoke execute on function public.claim_next_operational_job(public.operational_job_type, timestamptz, integer) from public;
grant execute on function public.claim_next_operational_job(public.operational_job_type, timestamptz, integer) to service_role;
