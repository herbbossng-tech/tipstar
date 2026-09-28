import { generateId } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { eloBaseline, poissonBaseline } from "./baselines.js";
import { buildTrainingDataset } from "./dataset/builder.js";
import { buildEvaluationSummary, type Evaluation1x2Prediction } from "./evaluation/index.js";
import { computeFeatureVector } from "./features/index.js";
import { combineEnsemble } from "./ensemble.js";
import { fitPlattCalibrator } from "./calibration.js";
import { toFeatureRow } from "./models/encode.js";
import { buildPredictionOutput } from "./output-contract.js";
import { checkProbability1x2 } from "./probability/consistency.js";
import { InMemoryFixturesRepository, InMemoryMatchResultsRepository } from "./repositories/fixtures.js";
import { InMemoryOddsObservationsRepository } from "./repositories/observations.js";
import { RandomForestModel } from "./models/random-forest.js";
import { generateWalkForwardWindows, splitExamplesByWindow } from "./validation/walk-forward.js";

/**
 * SYNTHETIC end-to-end integration test — the whole pipeline the
 * section's success condition describes:
 *
 *   historical canonical data → point-in-time features → leakage-safe
 *   training dataset → chronological walk-forward evaluation → baseline
 *   models → ML model → ensemble → calibration → probability
 *   consistency → versioned prediction output
 *
 * exercised together against one small deterministic league. This is
 * not a claim of real-world predictive accuracy — it proves every stage
 * actually connects to the next with the correct types and invariants,
 * which none of the per-module unit tests individually demonstrate.
 */
describe("Section 05 end-to-end pipeline", () => {
  it("runs historical data through every stage to a valid, versioned PredictionOutput", async () => {
    const fixtures = new InMemoryFixturesRepository();
    const matchResults = new InMemoryMatchResultsRepository();
    const oddsObservations = new InMemoryOddsObservationsRepository();
    const competitionId = generateId();
    const teamA = generateId();
    const teamB = generateId();
    const teamC = generateId();
    const teamD = generateId();

    async function play(home: string, away: string, hg: number, ag: number, kickoff: string) {
      const f = await fixtures.upsert({ competitionId, seasonId: undefined, homeTeamId: home, awayTeamId: away, scheduledKickoffAt: kickoff, status: "finished", providerStatusRaw: "FT", provider: "pipeline_test", providerFixtureId: `${home}-${away}-${kickoff}` });
      await matchResults.upsert({ fixtureId: f.id, homeGoals: hg, awayGoals: ag, halftimeHomeGoals: undefined, halftimeAwayGoals: undefined, resultRecordedAt: kickoff, source: "pipeline_test" });
      return f;
    }

    // 30 rounds of a 4-team round-robin-ish league across 2026, deterministic scores.
    const teams = [teamA, teamB, teamC, teamD];
    const playedFixtures = [];
    for (let round = 0; round < 30; round++) {
      const home = teams[round % 4]!;
      const away = teams[(round + 1) % 4]!;
      const kickoff = new Date(Date.UTC(2026, 0, 1 + round * 3, 15, 0, 0)).toISOString();
      const homeGoals = round % 3;
      const awayGoals = (round + 1) % 3;
      playedFixtures.push(await play(home, away, homeGoals, awayGoals, kickoff));
    }

    // 1. Training dataset from every completed fixture.
    const dataset = await buildTrainingDataset(
      { fixtures, matchResults, oddsObservations },
      { fixtures: playedFixtures, snapshotLeadTimeMinutes: 60, datasetVersion: "pipeline-test-v1", sourceVersion: "pipeline_test" },
    );
    expect(dataset.examples.length).toBeGreaterThan(20);

    // 2. Walk-forward split.
    const windows = generateWalkForwardWindows(dataset.examples, { minTrainingPeriodDays: 30, validationPeriodDays: 15, testPeriodDays: 15, stepDays: 15, embargoDays: 0, minSamplesPerWindow: 3 });
    expect(windows.length).toBeGreaterThan(0);
    const split = splitExamplesByWindow(dataset.examples, windows[0]!);
    expect(split.train.length).toBeGreaterThan(0);
    expect(split.test.length).toBeGreaterThan(0);

    // 3. Train an ML model on the TRAIN split only.
    const model = RandomForestModel.train({ examples: split.train, config: { numTrees: 10, maxDepth: 3, minSamplesLeaf: 1 }, randomSeed: 1, modelVersion: "rf-pipeline-v1", trainingDatasetVersion: dataset.datasetVersion });

    // 4. Evaluate the model on the TEST split (never seen during training).
    const testPredictions: Evaluation1x2Prediction[] = split.test.map((example) => ({
      fixtureId: example.fixtureId,
      competitionId: example.competitionId,
      seasonId: example.seasonId,
      predicted: model.predictProba(toFeatureRow(example, model.metadata.featureSchema)),
      actual: example.target1x2,
    }));
    for (const p of testPredictions) expect(checkProbability1x2(p.predicted).ok).toBe(true);

    const summary = buildEvaluationSummary({ datasetVersion: dataset.datasetVersion, modelVersion: model.metadata.modelVersion, predictions: testPredictions, examples: split.test, now: () => "2026-06-01T00:00:00Z" });
    expect(summary.sampleCount).toBe(split.test.length);
    expect(Number.isFinite(summary.accuracy)).toBe(true);

    // 5. Build baseline predictions for one fixture and ensemble them with the ML model.
    const targetExample = split.test[0]!;
    const targetFixture = (await fixtures.getById(targetExample.fixtureId))!;
    const eloResult = await eloBaseline({ fixtures, matchResults }, targetFixture, targetExample.snapshotTime);
    const poissonResult = await poissonBaseline({ fixtures, matchResults }, targetFixture, targetExample.snapshotTime);
    expect(eloResult.ok).toBe(true);
    expect(poissonResult.ok).toBe(true);
    if (!eloResult.ok || !poissonResult.ok) return;

    const mlProbability = model.predictProba(toFeatureRow(targetExample, model.metadata.featureSchema));
    const ensembleResult = combineEnsemble(
      [
        { name: "elo", modelVersion: "elo-baseline-v1", probability1x2: eloResult.value.probability1x2 },
        { name: "poisson", modelVersion: "poisson-baseline-v1", probability1x2: poissonResult.value.probability1x2 },
        { name: "random_forest", modelVersion: model.metadata.modelVersion, probability1x2: mlProbability },
      ],
      { ensembleVersion: "ensemble-pipeline-v1", weightSource: "configured_baseline", weights: { elo: 0.3, poisson: 0.3, random_forest: 0.4 } },
    );
    expect(ensembleResult.ok).toBe(true);
    if (!ensembleResult.ok) return;

    // 6. Calibrate the ensembled probability using a (separate, synthetic) calibration training set.
    const calibrator = fitPlattCalibrator({
      examples: split.train.slice(0, 10).map((e) => ({ rawProbability1x2: { home: 0.5, draw: 0.3, away: 0.2 }, actual: e.target1x2, kickoffTime: e.kickoffTime })),
      calibratorVersion: "platt-pipeline-v1",
      inputModelVersion: "ensemble-pipeline-v1",
      calibrationDatasetVersion: dataset.datasetVersion,
    });
    const calibratedProbability = calibrator.calibrate(ensembleResult.value.probability1x2);
    expect(checkProbability1x2(calibratedProbability).ok).toBe(true);

    // 7. Build the final versioned PredictionOutput.
    const outputResult = buildPredictionOutput({
      fixtureId: targetFixture.id,
      predictionTimestamp: "2026-06-01T00:00:00Z",
      snapshotTime: targetExample.snapshotTime,
      modelVersion: model.metadata.modelVersion,
      ensembleVersion: ensembleResult.value.ensembleVersion,
      calibrationVersion: calibrator.metadata.calibratorVersion,
      probability1x2: calibratedProbability,
      dataQuality: "AVAILABLE",
      featureVersions: Object.fromEntries(Object.values(targetExample.features).map((f) => [f.featureId, f.featureVersion])),
      sourceVersion: "pipeline_test",
      componentContributions: ensembleResult.value.componentContributions,
    });

    expect(outputResult.ok).toBe(true);
    if (!outputResult.ok) return;
    const output = outputResult.value;
    expect(output.homeWinProbability + output.drawProbability + output.awayWinProbability).toBeCloseTo(1, 9);
    expect(output.markets.find((m) => m.market === "1X2" && m.selection === "HOME")!.fairOdds).toBeCloseTo(1 / output.homeWinProbability, 9);
    expect(output.uncertainty.note).toContain("not a guarantee");
    expect(output.provenance.componentContributions).toBeDefined();

    // Sanity: the feature vector used for this fixture is itself reproducible (recomputing gives the same values).
    const recomputed = await computeFeatureVector({ fixtureId: targetFixture.id, snapshotTime: targetExample.snapshotTime, now: "2026-06-01T00:00:00Z" }, { fixtures, matchResults, oddsObservations }, targetFixture, "pipeline_test");
    expect(recomputed.elo_rating_diff?.value).toBe(targetExample.features.elo_rating_diff?.value);
  });
});
