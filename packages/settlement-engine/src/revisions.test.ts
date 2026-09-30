import { describe, expect, it } from "vitest";
import { createSettlementRevision, resolveCurrentSettlement } from "./revisions.js";
import { SettlementStatus, type Money } from "./types.js";

const ORIGINAL_ID = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-02-01T12:00:00Z";
const STAKE: Money = { amount: 100, currency: "NGN" };
const PAYOUT: Money = { amount: 0, currency: "NGN" };
const CORRECTED_PAYOUT: Money = { amount: 220, currency: "NGN" };

describe("createSettlementRevision", () => {
  it("produces a new, append-only revision record referencing the original settlement", () => {
    const revision = createSettlementRevision({
      originalSettlementId: ORIGINAL_ID,
      previousStatus: SettlementStatus.LOST,
      newStatus: SettlementStatus.WON,
      previousPayout: PAYOUT,
      newPayout: CORRECTED_PAYOUT,
      reason: "Provider corrected the final score after a VAR review.",
      source: "provider-correction",
      resultVersionId: "match-result-v2",
      now: NOW,
      createdBy: "system:settlement-engine",
    });
    expect(revision.originalSettlementId).toBe(ORIGINAL_ID);
    expect(revision.previousStatus).toBe(SettlementStatus.LOST);
    expect(revision.newStatus).toBe(SettlementStatus.WON);
    expect(revision.createdAt).toBe(NOW);
    expect(revision.revisionId).not.toBe(ORIGINAL_ID);
  });
});

describe("resolveCurrentSettlement", () => {
  it("returns the original status/payout unchanged when there are no revisions", () => {
    const result = resolveCurrentSettlement(SettlementStatus.LOST, PAYOUT, []);
    expect(result).toEqual({ status: SettlementStatus.LOST, payout: PAYOUT, revisionCount: 0, lastRevisedAt: undefined });
  });

  it("folds a single revision into the effective outcome without discarding it", () => {
    const revision = createSettlementRevision({
      originalSettlementId: ORIGINAL_ID,
      previousStatus: SettlementStatus.LOST,
      newStatus: SettlementStatus.WON,
      previousPayout: PAYOUT,
      newPayout: CORRECTED_PAYOUT,
      reason: "Correction",
      source: "test",
      now: NOW,
      createdBy: "system",
    });
    const result = resolveCurrentSettlement(SettlementStatus.LOST, PAYOUT, [revision]);
    expect(result.status).toBe(SettlementStatus.WON);
    expect(result.payout).toEqual(CORRECTED_PAYOUT);
    expect(result.revisionCount).toBe(1);
    expect(result.lastRevisedAt).toBe(NOW);
  });

  it("the LATEST revision in the chain wins — multiple corrections are all preserved, never merged", () => {
    const first = createSettlementRevision({ originalSettlementId: ORIGINAL_ID, previousStatus: SettlementStatus.LOST, newStatus: SettlementStatus.WON, previousPayout: PAYOUT, newPayout: CORRECTED_PAYOUT, reason: "r1", source: "test", now: "2026-02-01T12:00:00Z", createdBy: "system" });
    const second = createSettlementRevision({ originalSettlementId: ORIGINAL_ID, previousStatus: SettlementStatus.WON, newStatus: SettlementStatus.VOID, previousPayout: CORRECTED_PAYOUT, newPayout: STAKE, reason: "r2 — match abandoned after all", source: "test", now: "2026-02-02T12:00:00Z", createdBy: "system" });
    const result = resolveCurrentSettlement(SettlementStatus.LOST, PAYOUT, [first, second]);
    expect(result.status).toBe(SettlementStatus.VOID);
    expect(result.payout).toEqual(STAKE);
    expect(result.revisionCount).toBe(2);
    expect(result.lastRevisedAt).toBe("2026-02-02T12:00:00Z");
  });
});
