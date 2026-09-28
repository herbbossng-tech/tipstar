/**
 * Feature Engine boundary (Section 01 — Aviator Engine Boundary). Derives
 * features from round history available strictly before the round being
 * evaluated — see docs/data/DATA_LEAKAGE_PRINCIPLE.md. No feature
 * computation is implemented yet.
 */
export interface AviatorFeatureEngine {
  buildFeatures(asOfRoundId: string): Promise<Readonly<Record<string, number | null>>>;
}
