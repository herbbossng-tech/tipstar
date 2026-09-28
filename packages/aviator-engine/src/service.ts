import { NotImplementedError } from "@sport-os/shared";
import type { AviatorSignal } from "./signal-engine.js";

/**
 * AviatorService — the service-layer facade over the Aviator pipeline.
 * No stage is implemented yet.
 */
export interface AviatorService {
  getCurrentSignal(): Promise<AviatorSignal | undefined>;
}

export class NotImplementedAviatorService implements AviatorService {
  async getCurrentSignal(): Promise<AviatorSignal | undefined> {
    throw new NotImplementedError("AviatorService.getCurrentSignal");
  }
}
