import { NotImplementedError } from "@sport-os/shared";

export interface RiskAssessment {
  readonly approved: boolean;
  readonly reason: string;
}

export interface RiskAssessmentRequest {
  readonly agentType: string;
  readonly proposedStake: number;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * RiskService — sport-specific risk assessment boundary (distinct from
 * GlobalDailyRiskController, which is the cross-sport daily kill switch).
 * Real risk models are a later-section concern.
 */
export interface RiskService {
  assess(request: RiskAssessmentRequest): Promise<RiskAssessment>;
}

export class NotImplementedRiskService implements RiskService {
  async assess(_request: RiskAssessmentRequest): Promise<RiskAssessment> {
    throw new NotImplementedError("RiskService.assess");
  }
}
