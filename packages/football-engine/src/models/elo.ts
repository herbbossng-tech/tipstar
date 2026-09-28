/**
 * Elo rating model boundary (Section 01 — Football Engine Boundary). No
 * rating computation is implemented yet.
 */
export interface EloRating {
  readonly teamId: string;
  readonly rating: number;
  readonly asOf: string;
}

export interface EloRatingModel {
  getRating(teamId: string, asOf: string): Promise<EloRating | undefined>;
}
