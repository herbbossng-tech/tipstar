import { JobFailureCategory, OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import { err, generateId, ok, ValidationError, type AppError, type ISODateString, type Result } from "@sport-os/shared";
import { addMoney, computeNetPnl, computeRoi, type LedgerMode, type Money, type PerformanceLedgerEntry } from "@sport-os/settlement-engine";
import type { TelegramPublicationStatus } from "@sport-os/telegram";
import type { NewWeeklyReportInput, WeeklyReportRecord } from "./db/repositories.js";
import type { JobHandler, JobHandlerResult } from "./jobs/worker.js";

/**
 * Section 11 Parts J-O — the typed weekly report model and its real
 * generation service. The existing `WeeklyReportAgent` (Section 06
 * §13, `football/weekly-report-agent.ts`) remains the orchestration
 * boundary for a caller that already has a `Settlement[]` in hand; this
 * service is the Section 11 addition that sources its figures from the
 * REAL, PERSISTED `performance_ledger` rows a `PERFORMANCE_SNAPSHOT`
 * job produced — "report calculations must preserve PAPER vs LIVE
 * separation... never combine PAPER and LIVE... NULL semantics... never
 * convert unavailable financial metrics into zero." Every figure below
 * traces back to a real `PerformanceLedgerEntry` field; nothing here
 * computes a new financial number of its own beyond summing/deriving
 * from those already-real values via the SAME `@sport-os/settlement-
 * engine` arithmetic (`addMoney`/`computeNetPnl`/`computeRoi`) Section
 * 08 built — never a second implementation of that arithmetic.
 */

export interface WeeklyReportTicketCounts {
  readonly total: number;
  readonly settled: number;
  readonly won: number;
  readonly lost: number;
  readonly voided: number;
  readonly pushed: number;
  readonly pending: number;
}

export interface WeeklyReportBreakdownRow {
  readonly ticketType: string | undefined;
  readonly ticketCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly actualPnl: Money | null;
  readonly roi: number | null;
  readonly maxDrawdown: number | null;
  readonly longestLosingStreak: number | null;
  readonly sampleSize: number;
}

/** The combined total across every breakdown row — `undefined` when the breakdown rows span more than one currency (this codebase never silently combines currencies; see `@sport-os/settlement-engine`'s own `assertSameCurrency`). */
export interface WeeklyReportFinancialTotals {
  readonly actualStake: Money | null;
  readonly actualPayout: Money | null;
  readonly actualPnl: Money | null;
  readonly roi: number | null;
}

export interface WeeklyReportTelegramSummary {
  readonly publishedCount: number;
  readonly failedCount: number;
  readonly pendingCount: number;
}

export interface WeeklyReportOperationalIncident {
  readonly jobType: string;
  readonly failureCategory: string | undefined;
  readonly lastError: string | undefined;
  readonly occurredAt: ISODateString;
}

export interface WeeklyReport {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly ledgerMode: LedgerMode;
  readonly reportVersion: number;
  readonly generatedAt: ISODateString;
  readonly generatedBy: string;
  readonly ticketCounts: WeeklyReportTicketCounts;
  readonly breakdownByTicketType: readonly WeeklyReportBreakdownRow[];
  /** `undefined` only when zero performance_ledger rows exist for this period+mode yet — never fabricated as all-zero. */
  readonly financialTotals: WeeklyReportFinancialTotals | undefined;
  /** `undefined` when the caller did not supply Telegram publication data (e.g. a report generated before any publication was attempted). */
  readonly telegramPublicationSummary: WeeklyReportTelegramSummary | undefined;
  readonly operationalIncidents: readonly WeeklyReportOperationalIncident[];
  /** Always `undefined` today — no CLV figure is ever stored at the `performance_ledger` aggregate level (see `OPEN_QUESTIONS.md`). Never fabricated. */
  readonly closingLineValueSummary: undefined;
}

function sumTicketCounts(entries: readonly PerformanceLedgerEntry[]): WeeklyReportTicketCounts {
  return entries.reduce<WeeklyReportTicketCounts>(
    (acc, entry) => ({
      total: acc.total + entry.ticketCount,
      settled: acc.settled + entry.settledTicketCount,
      won: acc.won + entry.wins,
      lost: acc.lost + entry.losses,
      voided: acc.voided + entry.voids,
      pushed: acc.pushed + entry.pushes,
      pending: acc.pending + entry.pending,
    }),
    { total: 0, settled: 0, won: 0, lost: 0, voided: 0, pushed: 0, pending: 0 },
  );
}

function toBreakdownRow(entry: PerformanceLedgerEntry): WeeklyReportBreakdownRow {
  return {
    ticketType: entry.ticketType,
    ticketCount: entry.ticketCount,
    wins: entry.wins,
    losses: entry.losses,
    actualStake: entry.actualStake,
    actualPayout: entry.actualPayout,
    actualPnl: entry.actualPnl,
    roi: entry.roi,
    maxDrawdown: entry.maxDrawdown,
    longestLosingStreak: entry.longestLosingStreak,
    sampleSize: entry.sampleSize,
  };
}

/** `undefined` when there are no entries, or when the entries span more than one currency (never silently combined). */
function computeFinancialTotals(entries: readonly PerformanceLedgerEntry[]): WeeklyReportFinancialTotals | undefined {
  if (entries.length === 0) return undefined;
  const stakes = entries.map((e) => e.actualStake).filter((m): m is Money => m !== null);
  const payouts = entries.map((e) => e.actualPayout).filter((m): m is Money => m !== null);
  try {
    const actualStake = stakes.length > 0 ? stakes.reduce((sum, m) => addMoney(sum, m)) : null;
    const actualPayout = payouts.length > 0 ? payouts.reduce((sum, m) => addMoney(sum, m)) : null;
    const actualPnl = computeNetPnl(actualStake, actualPayout);
    const roi = computeRoi(actualPnl, actualStake);
    return { actualStake, actualPayout, actualPnl, roi };
  } catch {
    // Mixed currencies across breakdown rows — honestly "not available
    // as one combined total" rather than a thrown error aborting the
    // whole report; the per-row breakdown above still has the real,
    // per-currency figures.
    return undefined;
  }
}

export interface GenerateWeeklyReportParams {
  readonly periodStart: ISODateString;
  readonly periodEnd: ISODateString;
  readonly ledgerMode: LedgerMode;
  readonly generatedBy: string;
  readonly telegramPublicationSummary?: WeeklyReportTelegramSummary;
  readonly operationalIncidents?: readonly WeeklyReportOperationalIncident[];
}

/** The minimal, structural subset of `SupabasePerformanceLedgerRepository` this service actually reads — kept as an interface (not the concrete class) so it can be substituted with a fake in tests without a live Supabase client. */
export interface PerformanceLedgerReader {
  listForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<readonly PerformanceLedgerEntry[]>;
}

/** The minimal, structural subset of `SupabaseWeeklyReportsRepository` this service actually uses — same reasoning as `PerformanceLedgerReader` above. */
export interface WeeklyReportsStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<WeeklyReportRecord | undefined>;
  findCurrentForPeriod(periodStart: string, periodEnd: string, ledgerMode: string): Promise<WeeklyReportRecord | undefined>;
  create(input: NewWeeklyReportInput): Promise<WeeklyReportRecord>;
}

export interface WeeklyReportServiceDependencies {
  readonly ledger: PerformanceLedgerReader;
  readonly reports: WeeklyReportsStore;
}

/**
 * Generates (or returns the already-generated, idempotent) report for a
 * period+ledgerMode. "Reports must be immutable once finalized... use
 * idempotency for generation requests." A regeneration request for a
 * period that already has a FINALIZED report creates a NEW version row
 * with `supersedesReportId` set — the prior row is never touched.
 */
export async function generateWeeklyReport(deps: WeeklyReportServiceDependencies, params: GenerateWeeklyReportParams, regenerateReason?: string): Promise<Result<WeeklyReportRecord, AppError>> {
  const idempotencyKey = regenerateReason ? `weekly-report:${params.periodStart}:${params.periodEnd}:${params.ledgerMode}:regen:${generateId()}` : `weekly-report:${params.periodStart}:${params.periodEnd}:${params.ledgerMode}`;

  if (!regenerateReason) {
    const existing = await deps.reports.findByIdempotencyKey(idempotencyKey);
    if (existing) return ok(existing);
  }

  const entries = await deps.ledger.listForPeriod(params.periodStart, params.periodEnd, params.ledgerMode);
  const report: WeeklyReport = {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    ledgerMode: params.ledgerMode,
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: params.generatedBy,
    ticketCounts: sumTicketCounts(entries),
    breakdownByTicketType: entries.map(toBreakdownRow),
    financialTotals: computeFinancialTotals(entries),
    telegramPublicationSummary: params.telegramPublicationSummary,
    operationalIncidents: params.operationalIncidents ?? [],
    closingLineValueSummary: undefined,
  };

  const priorVersion = await deps.reports.findCurrentForPeriod(params.periodStart, params.periodEnd, params.ledgerMode);
  if (priorVersion && !regenerateReason) {
    // An idempotency-key miss (e.g. a differently-constructed key) but a
    // real prior version already exists — refuse rather than silently
    // create a second "version 1" for the same period.
    return err(new ValidationError({ message: "A report for this period already exists. Use regeneration with an explicit reason to create a new version.", code: "WEEKLY_REPORT_ALREADY_EXISTS" }));
  }

  try {
    const created = await deps.reports.create({
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      ledgerMode: params.ledgerMode,
      reportVersion: priorVersion ? priorVersion.reportVersion + 1 : 1,
      generatedBy: params.generatedBy,
      sourceReference: { performanceLedgerEntryCount: entries.length },
      reportPayload: report as unknown as Record<string, unknown>,
      idempotencyKey,
      ...(priorVersion ? { supersedesReportId: priorVersion.reportId, supersededReason: regenerateReason ?? "unspecified" } : {}),
    });
    return ok(created);
  } catch (error) {
    return err(error as AppError);
  }
}

/** WEEKLY_REPORT_GENERATION job handler — thin orchestration over `generateWeeklyReport()`, never a second report-building implementation. */
export class WeeklyReportGenerationJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.WEEKLY_REPORT_GENERATION;

  constructor(private readonly deps: WeeklyReportServiceDependencies) {}

  async handle(job: OperationalJobRecord): Promise<JobHandlerResult> {
    const periodStart = job.payloadReference.periodStart as string | undefined;
    const periodEnd = job.payloadReference.periodEnd as string | undefined;
    const ledgerMode = job.payloadReference.ledgerMode as LedgerMode | undefined;
    if (!periodStart || !periodEnd || !ledgerMode) {
      return { ok: false, category: JobFailureCategory.INVALID_PAYLOAD, message: "payloadReference.periodStart/periodEnd/ledgerMode are required." };
    }
    const result = await generateWeeklyReport(this.deps, { periodStart, periodEnd, ledgerMode, generatedBy: job.createdBy });
    if (!result.ok) {
      return { ok: false, category: JobFailureCategory.UNKNOWN, message: result.error.message };
    }
    return { ok: true };
  }
}

/** Resolves a Telegram publication summary from real, already-persisted `TelegramPublicationRecord.status` values — never fabricated counts. */
export function summarizeTelegramPublications(statuses: readonly TelegramPublicationStatus[]): WeeklyReportTelegramSummary {
  return {
    publishedCount: statuses.filter((s) => s === "PUBLISHED").length,
    failedCount: statuses.filter((s) => s === "FAILED").length,
    pendingCount: statuses.filter((s) => s === "PENDING" || s === "RETRYING").length,
  };
}
