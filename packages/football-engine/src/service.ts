import { NotImplementedError } from "@sport-os/shared";
import type { ValueAssessment } from "./decision.js";

/**
 * FootballService — the service-layer facade over the football pipeline
 * (ingestion -> feature engineering -> models -> ensemble -> calibration
 * -> decision). No stage is implemented yet, so this facade has nothing
 * real to call — it exists to fix the boundary other packages code
 * against.
 */
export interface FootballService {
  evaluateEvent(eventId: string): Promise<readonly ValueAssessment[]>;
}

export class NotImplementedFootballService implements FootballService {
  async evaluateEvent(_eventId: string): Promise<readonly ValueAssessment[]> {
    throw new NotImplementedError("FootballService.evaluateEvent");
  }
}
