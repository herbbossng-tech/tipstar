import { LedgerMode, type PerformanceLedgerEntry } from "@sport-os/settlement-engine";
import { describe, expect, it } from "vitest";
import type { NewWeeklyReportInput, WeeklyReportRecord } from "./db/repositories.js";
import { generateWeeklyReport, summarizeTelegramPublications, type PerformanceLedgerReader, type WeeklyReport, type WeeklyReportsStore } from "./weekly-report-service.js";

class FakeLedgerReader implements PerformanceLedgerReader {
  constructor(private readonly entries: readonly PerformanceLedgerEntry[]) {}
  async listForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<readonly PerformanceLedgerEntry[]> {
    return this.entries.filter((e) => e.periodStart === periodStart && e.periodEnd === periodEnd && e.ledgerMode === ledgerMode);
  }
}

class FakeReportsStore implements WeeklyReportsStore {
  private readonly byKey = new Map<string, WeeklyReportRecord>();
  private readonly byPeriod = new Map<string, WeeklyReportRecord[]>();
  private nextId = 1;

  async findByIdempotencyKey(idempotencyKey: string): Promise<WeeklyReportRecord | undefined> {
    return this.byKey.get(idempotencyKey);
  }
  async findCurrentForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<WeeklyReportRecord | undefined> {
    const key = `${periodStart}:${periodEnd}:${ledgerMode}`;
    const versions = this.byPeriod.get(key) ?? [];
    return versions.sort((a, b) => b.reportVersion - a.reportVersion)[0];
  }
  async create(input: NewWeeklyReportInput): Promise<WeeklyReportRecord> {
    const record: WeeklyReportRecord = {
      reportId: `report-${this.nextId++}` as never,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      ledgerMode: input.ledgerMode,
      reportVersion: input.reportVersion,
      status: "FINALIZED",
      generatedAt: new Date().toISOString(),
      generatedBy: input.generatedBy,
      sourceReference: input.sourceReference,
      reportPayload: input.reportPayload,
      supersedesReportId: input.supersedesReportId,
      supersededReason: input.supersededReason,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.byKey.set(input.idempotencyKey, record);
    const key = `${input.periodStart}:${input.periodEnd}:${input.ledgerMode}`;
    this.byPeriod.set(key, [...(this.byPeriod.get(key) ?? []), record]);
    return record;
  }
}

function entry(overrides: Partial<PerformanceLedgerEntry> = {}): PerformanceLedgerEntry {
  return {
    periodStart: "2026-01-01T00:00:00Z",
    periodEnd: "2026-01-07T23:59:59Z",
    ledgerMode: LedgerMode.LIVE,
    sport: "football",
    league: undefined,
    market: undefined,
    modelVersion: undefined,
    decisionPolicyVersion: undefined,
    ticketType: "SINGLE",
    ticketCount: 10,
    legCount: 10,
    executedTicketCount: 10,
    settledTicketCount: 10,
    wins: 6,
    losses: 4,
    voids: 0,
    pushes: 0,
    pending: 0,
    actualStake: { amount: 100, currency: "NGN" },
    actualPayout: { amount: 120, currency: "NGN" },
    actualPnl: { amount: 20, currency: "NGN" },
    roi: 0.2,
    expectedEv: null,
    maxDrawdown: 15,
    longestLosingStreak: 2,
    sampleSize: 10,
    ...overrides,
  };
}

describe("generateWeeklyReport — Section 11 §J-§O", () => {
  it("TEST 1: aggregates real performance_ledger entries into ticket counts and financial totals — never fabricated", async () => {
    const ledger = new FakeLedgerReader([entry()]);
    const reports = new FakeReportsStore();
    const result = await generateWeeklyReport({ ledger, reports }, { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const report = result.value.reportPayload as unknown as WeeklyReport;
      expect(report.ticketCounts.total).toBe(10);
      expect(report.ticketCounts.won).toBe(6);
      expect(report.financialTotals?.actualPnl).toEqual({ amount: 20, currency: "NGN" });
    }
  });

  it("TEST 2: zero performance_ledger rows produces an honest zero-ticket report with financialTotals undefined, never fabricated non-zero figures", async () => {
    const ledger = new FakeLedgerReader([]);
    const reports = new FakeReportsStore();
    const result = await generateWeeklyReport({ ledger, reports }, { periodStart: "2026-02-01T00:00:00Z", periodEnd: "2026-02-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const report = result.value.reportPayload as unknown as WeeklyReport;
      expect(report.ticketCounts.total).toBe(0);
      expect(report.financialTotals).toBeUndefined();
    }
  });

  it("TEST 3: PAPER and LIVE entries for the same period are never combined into one report — each ledgerMode is queried and reported separately", async () => {
    const ledger = new FakeLedgerReader([entry({ ledgerMode: LedgerMode.LIVE, ticketCount: 5 }), entry({ ledgerMode: LedgerMode.PAPER, ticketCount: 999 })]);
    const reports = new FakeReportsStore();
    const result = await generateWeeklyReport({ ledger, reports }, { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const report = result.value.reportPayload as unknown as WeeklyReport;
      expect(report.ticketCounts.total).toBe(5);
    }
  });

  it("TEST 4: a repeated generation request for the same period is idempotent — returns the SAME report, never a duplicate", async () => {
    const ledger = new FakeLedgerReader([entry()]);
    const reports = new FakeReportsStore();
    const params = { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" } as const;
    const first = await generateWeeklyReport({ ledger, reports }, params);
    const second = await generateWeeklyReport({ ledger, reports }, params);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.value.reportId).toBe(second.value.reportId);
  });

  it("TEST 5: regeneration creates a NEW version linked to the prior one — never overwrites it", async () => {
    const ledger = new FakeLedgerReader([entry()]);
    const reports = new FakeReportsStore();
    const params = { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" } as const;
    const first = await generateWeeklyReport({ ledger, reports }, params);
    expect(first.ok).toBe(true);
    const second = await generateWeeklyReport({ ledger, reports }, params, "source data corrected");
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.reportId).not.toBe(first.value.reportId);
      expect(second.value.reportVersion).toBe(2);
      expect(second.value.supersedesReportId).toBe(first.value.reportId);
      expect(second.value.supersededReason).toBe("source data corrected");
    }
  });

  it("TEST 6: a mixed-currency breakdown never silently combines into one total — financialTotals is undefined, per-row figures remain", async () => {
    const ledger = new FakeLedgerReader([entry({ ticketType: "SINGLE", actualStake: { amount: 100, currency: "NGN" }, actualPayout: { amount: 120, currency: "NGN" } }), entry({ ticketType: "ACCUMULATOR", actualStake: { amount: 50, currency: "KES" }, actualPayout: { amount: 40, currency: "KES" } })]);
    const reports = new FakeReportsStore();
    const result = await generateWeeklyReport({ ledger, reports }, { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const report = result.value.reportPayload as unknown as WeeklyReport;
      expect(report.financialTotals).toBeUndefined();
      expect(report.breakdownByTicketType).toHaveLength(2);
    }
  });

  it("TEST 7: never a fabricated CLV summary — always undefined", async () => {
    const ledger = new FakeLedgerReader([entry()]);
    const reports = new FakeReportsStore();
    const result = await generateWeeklyReport({ ledger, reports }, { periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-01-07T23:59:59Z", ledgerMode: LedgerMode.LIVE, generatedBy: "system" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const report = result.value.reportPayload as unknown as WeeklyReport;
      expect(report.closingLineValueSummary).toBeUndefined();
    }
  });
});

describe("summarizeTelegramPublications — real statuses only, never fabricated counts", () => {
  it("TEST 8: counts PUBLISHED/FAILED/PENDING+RETRYING correctly", () => {
    const summary = summarizeTelegramPublications(["PUBLISHED", "PUBLISHED", "FAILED", "PENDING", "RETRYING"] as never);
    expect(summary).toEqual({ publishedCount: 2, failedCount: 1, pendingCount: 2 });
  });
  it("TEST 9: an empty list is an honest all-zero summary, not undefined", () => {
    expect(summarizeTelegramPublications([])).toEqual({ publishedCount: 0, failedCount: 0, pendingCount: 0 });
  });
});
