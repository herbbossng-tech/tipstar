/**
 * Feature Store boundary (Section 01 — Football Engine Boundary).
 * Persists/retrieves computed, point-in-time-safe features for reuse
 * across models. Persistence is a Section 03 (database) concern.
 */
export interface FootballFeatureStore {
  get(eventId: string): Promise<Readonly<Record<string, number | null>> | undefined>;
  put(eventId: string, features: Readonly<Record<string, number | null>>): Promise<void>;
}
