/**
 * Monte Carlo simulation boundary (Section 01 — Football Engine
 * Boundary). No simulation is implemented yet.
 */
export interface MonteCarloSimulationResult {
  readonly eventId: string;
  readonly iterations: number;
  readonly outcomeDistribution: Readonly<Record<string, number>>;
}

export interface MonteCarloSimulator {
  simulate(eventId: string, iterations: number): Promise<MonteCarloSimulationResult>;
}
