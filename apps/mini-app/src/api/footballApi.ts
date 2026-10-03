import { authedGet } from "../services/api.js";
import type { FixtureDetailResponse, FootballFixturesResponse } from "./types.js";

/** Fetches fixtures for one UTC day (`date` omitted = today) from `/football-fixtures` (Section 09 §11). Never computes a fixture list client-side. */
export async function getFootballFixtures(sessionToken: string, params: { readonly date?: string; readonly competitionId?: string } = {}): Promise<FootballFixturesResponse> {
  return authedGet<FootballFixturesResponse>("/football-fixtures", sessionToken, params);
}

/** Fetches one fixture's real match intelligence from `/football-fixture-detail` (Section 09 §12). Never computes probability/EV/fair-odds client-side — every figure comes from the server's own `value_evaluations` row. */
export async function getFixtureIntelligence(sessionToken: string, fixtureId: string): Promise<FixtureDetailResponse> {
  return authedGet<FixtureDetailResponse>("/football-fixture-detail", sessionToken, { fixtureId });
}
