import type { EnsembleComponentPrediction } from "@sport-os/football-engine";
import { buildPredictionOutput } from "@sport-os/football-engine";
import { describe, expect, it } from "vitest";
import { FootballIntelligenceAgent, FootballIntelligenceAgentEligibility } from "./intelligence-agent.js";

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const SNAPSHOT_TIME = "2026-01-10T18:00:00Z";

function buildPrediction(dataQuality: "AVAILABLE" | "MISSING" | "LOW_CONFIDENCE" = "AVAILABLE") {
  const result = buildPredictionOutput({
    fixtureId: FIXTURE_ID,
    predictionTimestamp: SNAPSHOT_TIME,
    snapshotTime: SNAPSHOT_TIME,
    modelVersion: "ensemble-v1",
    probability1x2: { home: 0.6, draw: 0.25, away: 0.15 },
    dataQuality,
    featureVersions: {},
    sourceVersion: "test-v1",
  });
  if (!result.ok) throw new Error("test setup failed");
  return result.value;
}

describe("FootballIntelligenceAgent", () => {
  it("passes the prediction through untouched and computes eligibility ELIGIBLE for good data quality with no components", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const prediction = buildPrediction();
    const response = await agent.execute({
      requestId: "req-1",
      input: { fixtureId: FIXTURE_ID, snapshotTime: SNAPSHOT_TIME, predictionOutput: prediction, componentPredictions: [] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.prediction).toBe(prediction);
    expect(response.output.eligibility).toBe(FootballIntelligenceAgentEligibility.ELIGIBLE);
    expect(response.output.modelAgreement).toBeUndefined();
  });

  it("flags INSUFFICIENT_DATA_QUALITY when the prediction's dataQuality is MISSING", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const prediction = buildPrediction("MISSING");
    const response = await agent.execute({
      requestId: "req-1",
      input: { fixtureId: FIXTURE_ID, snapshotTime: SNAPSHOT_TIME, predictionOutput: prediction, componentPredictions: [] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.eligibility).toBe(FootballIntelligenceAgentEligibility.INSUFFICIENT_DATA_QUALITY);
  });

  it("computes model agreement and flags MODEL_DISAGREEMENT_HIGH when most components disagree with the ensemble's top pick", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    // Ensemble top pick is HOME (0.6), but 2 of 3 components actually favor AWAY.
    const prediction = buildPrediction();
    const components: EnsembleComponentPrediction[] = [
      { name: "elo", modelVersion: "v1", probability1x2: { home: 0.2, draw: 0.2, away: 0.6 } },
      { name: "poisson", modelVersion: "v1", probability1x2: { home: 0.2, draw: 0.2, away: 0.6 } },
      { name: "ml", modelVersion: "v1", probability1x2: { home: 0.6, draw: 0.25, away: 0.15 } },
    ];
    const response = await agent.execute({
      requestId: "req-1",
      input: { fixtureId: FIXTURE_ID, snapshotTime: SNAPSHOT_TIME, predictionOutput: prediction, componentPredictions: components },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(response.output.modelAgreement?.agreementRatio).toBeCloseTo(1 / 3);
    expect(response.output.modelAgreement?.unanimous).toBe(false);
    expect(response.output.eligibility).toBe(FootballIntelligenceAgentEligibility.MODEL_DISAGREEMENT_HIGH);
  });

  it("rejects a fixtureId/snapshotTime mismatch rather than silently using the wrong prediction (adversarial: input tampering)", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const prediction = buildPrediction();
    await expect(
      agent.execute({
        requestId: "req-1",
        input: { fixtureId: "99999999-9999-9999-9999-999999999999", snapshotTime: SNAPSHOT_TIME, predictionOutput: prediction, componentPredictions: [] },
        audit: { requestId: "req-1", actor: "user-1" },
      }),
    ).rejects.toThrow(/fixtureId/i);
  });

  it("never produces a stake, market ranking, or execution decision — the output has no such fields at all", async () => {
    const agent = new FootballIntelligenceAgent();
    agent.markReady();
    const prediction = buildPrediction();
    const response = await agent.execute({
      requestId: "req-1",
      input: { fixtureId: FIXTURE_ID, snapshotTime: SNAPSHOT_TIME, predictionOutput: prediction, componentPredictions: [] },
      audit: { requestId: "req-1", actor: "user-1" },
    });
    expect(Object.keys(response.output)).not.toContain("stake");
    expect(Object.keys(response.output)).not.toContain("bestMarket");
    expect(Object.keys(response.output)).not.toContain("executionResult");
  });
});
