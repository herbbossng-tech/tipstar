-- public.intelligence_calibration_versions (Section 05 — Calibration
-- Engine). "Record: calibrator type, version, training range, input
-- model version, calibration dataset version. Produce calibration
-- metrics." The calibrator's own fitted state (Platt A/B per class, or
-- isotonic blocks per class) is stored so a selected calibrator can be
-- reloaded without refitting.

create table public.intelligence_calibration_versions (
  id uuid primary key default gen_random_uuid(),
  calibrator_type public.calibrator_type not null,
  calibrator_version text not null unique,
  training_range_start timestamptz not null,
  training_range_end timestamptz not null,
  input_model_version text not null,
  calibration_dataset_version text not null references public.intelligence_dataset_versions (dataset_version),
  -- Set by selectCalibrator() against a validation-period sample —
  -- never the test set. See packages/football-engine/src/calibration.ts.
  validation_log_loss double precision null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  check (training_range_end >= training_range_start)
);

comment on table public.intelligence_calibration_versions is
  'One row per fitted calibrator. A calibrator is never refit into an existing row — a new fit is always a new row with a new calibrator_version.';

create index intelligence_calibration_versions_input_model_idx on public.intelligence_calibration_versions (input_model_version);

alter table public.intelligence_calibration_versions enable row level security;
