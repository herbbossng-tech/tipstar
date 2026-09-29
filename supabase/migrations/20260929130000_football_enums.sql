-- Section 04 — Football Data Ingestion + Data Quality + Leakage
-- Protection. Enum types for the canonical football data model.
--
-- Only the states genuinely required are introduced (per the section's
-- own "only create entities/states that are actually required" rule).
-- The original provider status string is always preserved separately
-- (fixtures.provider_status_raw) for provenance — normalization must
-- never destroy the source value.

create type public.match_status as enum (
  'scheduled', 'timed', 'live', 'halftime', 'finished',
  'postponed', 'cancelled', 'abandoned', 'suspended', 'unknown'
);

create type public.match_event_type as enum (
  'goal', 'own_goal', 'penalty_goal', 'missed_penalty',
  'yellow_card', 'red_card', 'substitution', 'var'
);

create type public.ingestion_status as enum ('running', 'completed', 'partial', 'failed');

-- BACKFILL vs LIVE (Section 04 — Backfilling). A backfilled observation
-- must never be indistinguishable from a live one just because it was
-- imported today.
create type public.ingestion_mode as enum ('backfill', 'live');

create type public.data_conflict_status as enum ('unresolved', 'resolved');

-- Section 04 — Odds Timestamp Rule: "If provider timestamp is
-- unavailable, mark the observation's temporal reliability as limited.
-- Do not silently claim point-in-time accuracy."
create type public.temporal_reliability as enum ('confirmed', 'estimated');
