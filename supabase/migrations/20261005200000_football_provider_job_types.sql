-- Section 13 — Real Football Data Provider Integration.
--
-- Adds three new operational_job_type values for football data
-- ingestion, using the EXISTING durable job infrastructure
-- (operational_jobs, claim_next_operational_job()) Section 12 already
-- built — no second job system, no second worker architecture.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run in its own
-- transaction, separate from anything that then reads the new value —
-- this migration does nothing else, so later migrations/application
-- code may freely use these values.

alter type public.operational_job_type add value 'FOOTBALL_REFERENCE_INGESTION';
alter type public.operational_job_type add value 'FOOTBALL_FIXTURE_INGESTION';
alter type public.operational_job_type add value 'FOOTBALL_ODDS_INGESTION';
