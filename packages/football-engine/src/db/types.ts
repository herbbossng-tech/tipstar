/**
 * Row shapes matching supabase/migrations/2026092913*.sql exactly
 * (Section 04). Snake_case, the wire shape Supabase actually returns —
 * repository implementations translate to/from the camelCase domain
 * types in canonical.ts. Mirrors the split @sport-os/platform's
 * db/types.ts already established in Section 03.
 */

export type MatchStatusRow = "scheduled" | "timed" | "live" | "halftime" | "finished" | "postponed" | "cancelled" | "abandoned" | "suspended" | "unknown";

export type MatchEventTypeRow = "goal" | "own_goal" | "penalty_goal" | "missed_penalty" | "yellow_card" | "red_card" | "substitution" | "var";

export type IngestionStatusRow = "running" | "completed" | "partial" | "failed";
export type IngestionModeRow = "backfill" | "live";
export type DataConflictStatusRow = "unresolved" | "resolved";
export type TemporalReliabilityRow = "confirmed" | "estimated";

export interface DataSourceRow {
  readonly id: string;
  readonly provider: string;
  readonly display_name: string;
  readonly kind: "football_data" | "odds";
  readonly enabled: boolean;
  readonly base_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CompetitionRow {
  readonly id: string;
  readonly provider: string;
  readonly provider_competition_id: string;
  readonly name: string;
  readonly country: string | null;
  readonly competition_type: string | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SeasonRow {
  readonly id: string;
  readonly competition_id: string;
  readonly provider: string;
  readonly provider_season_id: string;
  readonly name: string;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly status: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface VenueRow {
  readonly id: string;
  readonly provider: string | null;
  readonly provider_venue_id: string | null;
  readonly name: string;
  readonly city: string | null;
  readonly country: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TeamRow {
  readonly id: string;
  readonly provider: string;
  readonly provider_team_id: string;
  readonly name: string;
  readonly short_name: string | null;
  readonly country: string | null;
  readonly venue_id: string | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FixtureRow {
  readonly id: string;
  readonly competition_id: string;
  readonly season_id: string | null;
  readonly home_team_id: string;
  readonly away_team_id: string;
  readonly scheduled_kickoff_at: string;
  readonly actual_kickoff_at: string | null;
  readonly status: MatchStatusRow;
  readonly provider_status_raw: string | null;
  readonly venue_id: string | null;
  readonly provider: string;
  readonly provider_fixture_id: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MatchResultRow {
  readonly id: string;
  readonly fixture_id: string;
  readonly home_goals: number;
  readonly away_goals: number;
  readonly halftime_home_goals: number | null;
  readonly halftime_away_goals: number | null;
  readonly result_recorded_at: string;
  readonly source: string;
  readonly corrected_at: string | null;
  readonly correction_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MatchEventRow {
  readonly id: string;
  readonly fixture_id: string;
  readonly event_type: MatchEventTypeRow;
  readonly provider_event_type: string | null;
  readonly team_id: string | null;
  readonly minute: number | null;
  readonly observed_at: string;
  readonly provider: string;
  readonly provider_event_id: string | null;
  readonly created_at: string;
}

export interface TeamObservationRow {
  readonly id: string;
  readonly team_id: string;
  readonly fixture_id: string | null;
  readonly competition_id: string | null;
  readonly observation_type: string;
  readonly metrics: Record<string, unknown>;
  readonly observed_at: string;
  readonly provider_published_at: string | null;
  readonly source_updated_at: string | null;
  readonly provider: string;
  readonly provider_observation_id: string | null;
  readonly ingestion_run_id: string | null;
  readonly created_at: string;
}

export interface OddsObservationRow {
  readonly id: string;
  readonly fixture_id: string;
  readonly market_type: string;
  readonly selection: string;
  readonly odds: number;
  readonly bookmaker_source: string;
  readonly observed_at: string;
  readonly provider_published_at: string | null;
  readonly temporal_reliability: TemporalReliabilityRow;
  readonly provider: string;
  readonly provider_observation_id: string | null;
  readonly ingestion_run_id: string | null;
  readonly created_at: string;
}

export interface IngestionRunRow {
  readonly id: string;
  readonly provider: string;
  readonly mode: IngestionModeRow;
  readonly status: IngestionStatusRow;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly records_received: number;
  readonly records_inserted: number;
  readonly records_updated: number;
  readonly records_rejected: number;
  readonly error_count: number;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface DataQuarantineRow {
  readonly id: string;
  readonly provider: string;
  readonly provider_record_id: string | null;
  readonly entity_type: string;
  readonly reason: string;
  readonly raw_payload: Record<string, unknown> | null;
  readonly detected_at: string;
  readonly ingestion_run_id: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}

export interface DataConflictRow {
  readonly id: string;
  readonly entity_type: string;
  readonly entity_ref: string;
  readonly field: string;
  readonly source_a: string;
  readonly value_a: string | null;
  readonly source_b: string;
  readonly value_b: string | null;
  readonly detected_at: string;
  readonly resolution_status: DataConflictStatusRow;
  readonly resolved_value: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}
