import { BaseAgent, SideEffectLevel, type AgentDeclaration, type AgentRequest, type AgentResponse } from "@sport-os/agent-core";
import { Entitlement } from "@sport-os/platform";
import { ValidationError, type ISODateString, type UUID } from "@sport-os/shared";
import type { EnsembleComponentPrediction } from "@sport-os/football-engine";
import type { FeatureQuality } from "@sport-os/football-engine";
import type { PredictionOutput } from "@sport-os/football-engine";

/**
 * Football Intelligence Agent (Section 06 §8). Wraps and summarizes
 * Section 05's own output — it computes NOTHING new about probabilities.
 * Every number in `FootballIntelligenceResult.prediction` is passed
 * through byte-for-byte from the `PredictionOutput` the caller supplies
 * (already built via `buildPredictionOutput()` from a real
 * `LeakageGuard.getDataAsOf()` + ensemble + calibration run — see
 * `docs/architecture/FOOTBALL_INTELLIGENCE.md`). This agent's only real
 * work is: (1) summarizing cross-model agreement from the raw component
 * predictions that fed the ensemble, and (2) deriving `eligibility` from
 * `dataQuality`/warnings — never a bet, a market ranking, a stake, or an
 * execution/publish action, all of which are explicitly out of scope
 * (§8: "must NOT choose a bet, declare 'best market', construct an
 * accumulator, set stake, execute a bookmaker action, publish to
 * Telegram").
 */

export const FootballIntelligenceAgentEligibility = {
  ELIGIBLE: "eligible",
  INSUFFICIENT_DATA_QUALITY: "insufficient_data_quality",
  MODEL_DISAGREEMENT_HIGH: "model_disagreement_high",
} as const;
export type FootballIntelligenceAgentEligibility = (typeof FootballIntelligenceAgentEligibility)[keyof typeof FootballIntelligenceAgentEligibility];

export interface ModelAgreementSummary {
  /** Each contributing component's own top pick (HOME/DRAW/AWAY, whichever probability it assigned the highest) — raw fact, not an opinion this agent forms. */
  readonly topPickByComponent: Readonly<Record<string, "HOME" | "DRAW" | "AWAY">>;
  /** Fraction of components (0-1) that agree with the ENSEMBLE's own top pick — 1.0 means every component agrees with the combined output, not merely with each other. */
  readonly agreementRatio: number;
  /** true only when every contributing component's top pick matches the ensemble's — the strict case callers most often care about. */
  readonly unanimous: boolean;
}

export interface FootballIntelligenceAgentInput {
  readonly fixtureId: UUID;
  readonly snapshotTime: ISODateString;
  /** Already built by the caller via football-engine's own real pipeline — this agent never constructs one itself. */
  readonly predictionOutput: PredictionOutput;
  /** The raw per-component predictions that fed `predictionOutput`'s ensemble (empty when the prediction came from a single model, not an ensemble). */
  readonly componentPredictions: readonly EnsembleComponentPrediction[];
}

export interface FootballIntelligenceResult {
  readonly fixtureId: UUID;
  readonly snapshotTime: ISODateString;
  readonly prediction: PredictionOutput;
  readonly modelAgreement: ModelAgreementSummary | undefined;
  readonly dataQuality: FeatureQuality;
  readonly warnings: readonly string[];
  readonly eligibility: FootballIntelligenceAgentEligibility;
}

function topPick(p: { readonly home: number; readonly draw: number; readonly away: number }): "HOME" | "DRAW" | "AWAY" {
  if (p.home >= p.draw && p.home >= p.away) return "HOME";
  if (p.draw >= p.home && p.draw >= p.away) return "DRAW";
  return "AWAY";
}

function summarizeModelAgreement(prediction: PredictionOutput, components: readonly EnsembleComponentPrediction[]): ModelAgreementSummary | undefined {
  if (components.length === 0) return undefined;
  const ensembleTopPick = topPick({ home: prediction.homeWinProbability, draw: prediction.drawProbability, away: prediction.awayWinProbability });
  const topPickByComponent: Record<string, "HOME" | "DRAW" | "AWAY"> = {};
  let agreeing = 0;
  for (const component of components) {
    const pick = topPick(component.probability1x2);
    topPickByComponent[component.name] = pick;
    if (pick === ensembleTopPick) agreeing += 1;
  }
  const agreementRatio = agreeing / components.length;
  return { topPickByComponent, agreementRatio, unanimous: agreementRatio === 1 };
}

const DATA_QUALITY_INELIGIBLE: ReadonlySet<FeatureQuality> = new Set(["MISSING", "INVALID"]);
/** Below this ratio, cross-model disagreement is flagged as a warning-level eligibility concern — a product/UX threshold, not a statistical one; deliberately conservative and documented here as the one place it's set. */
const LOW_AGREEMENT_THRESHOLD = 0.5;

function deriveEligibility(dataQuality: FeatureQuality, agreement: ModelAgreementSummary | undefined): FootballIntelligenceAgentEligibility {
  if (DATA_QUALITY_INELIGIBLE.has(dataQuality)) return FootballIntelligenceAgentEligibility.INSUFFICIENT_DATA_QUALITY;
  if (agreement && agreement.agreementRatio < LOW_AGREEMENT_THRESHOLD) return FootballIntelligenceAgentEligibility.MODEL_DISAGREEMENT_HIGH;
  return FootballIntelligenceAgentEligibility.ELIGIBLE;
}

function deriveWarnings(dataQuality: FeatureQuality, agreement: ModelAgreementSummary | undefined): readonly string[] {
  const warnings: string[] = [];
  if (dataQuality === "STALE") warnings.push("Underlying feature data is stale relative to its freshness expectation.");
  if (dataQuality === "LOW_CONFIDENCE") warnings.push("Prediction is based on limited history for one or more features.");
  if (dataQuality === "SYNTHETIC") warnings.push("Prediction is based on synthetic test data, never real-world signal.");
  if (agreement && !agreement.unanimous && agreement.agreementRatio >= LOW_AGREEMENT_THRESHOLD) warnings.push("Contributing models do not unanimously agree on the top outcome.");
  return warnings;
}

export const FOOTBALL_INTELLIGENCE_AGENT_DECLARATION: AgentDeclaration = {
  agentId: "football-intelligence-agent",
  agentType: "football_intelligence",
  version: "0.1.0",
  capabilities: ["read_football_data", "read_feature_store", "request_model_inference", "produce_probabilities", "produce_intelligence_package"],
  requiredEntitlements: [Entitlement.FOOTBALL_ANALYSIS],
  allowedInputs: ["REQUEST_FOOTBALL_INTELLIGENCE"],
  allowedOutputs: ["INTELLIGENCE_GENERATED"],
  dependencies: [],
  // Never anything more than ANALYSIS — this agent reads and summarizes, it proposes nothing and requests no action.
  sideEffectLevel: SideEffectLevel.ANALYSIS,
};

export class FootballIntelligenceAgent extends BaseAgent<FootballIntelligenceAgentInput, FootballIntelligenceResult> {
  constructor(agentId: string = FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.agentId) {
    super({ agentId, agentType: FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.agentType, name: "Football Intelligence Agent", version: FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.version, capabilities: FOOTBALL_INTELLIGENCE_AGENT_DECLARATION.capabilities });
  }

  async execute(request: AgentRequest<FootballIntelligenceAgentInput>): Promise<AgentResponse<FootballIntelligenceResult>> {
    const { input } = request;
    if (input.fixtureId !== input.predictionOutput.fixtureId) {
      throw new ValidationError({ message: "predictionOutput.fixtureId does not match the requested fixtureId.", code: "FOOTBALL_INTELLIGENCE_FIXTURE_MISMATCH", context: { requested: input.fixtureId, actual: input.predictionOutput.fixtureId } });
    }
    if (input.snapshotTime !== input.predictionOutput.snapshotTime) {
      throw new ValidationError({ message: "predictionOutput.snapshotTime does not match the requested snapshotTime.", code: "FOOTBALL_INTELLIGENCE_SNAPSHOT_MISMATCH", context: { requested: input.snapshotTime, actual: input.predictionOutput.snapshotTime } });
    }

    const modelAgreement = summarizeModelAgreement(input.predictionOutput, input.componentPredictions);
    const eligibility = deriveEligibility(input.predictionOutput.dataQuality, modelAgreement);
    const warnings = deriveWarnings(input.predictionOutput.dataQuality, modelAgreement);

    const result: FootballIntelligenceResult = {
      fixtureId: input.fixtureId,
      snapshotTime: input.snapshotTime,
      prediction: input.predictionOutput,
      modelAgreement,
      dataQuality: input.predictionOutput.dataQuality,
      warnings,
      eligibility,
    };
    return { requestId: request.requestId, output: result, completedAt: new Date().toISOString() };
  }
}
