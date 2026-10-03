import { JobFailureCategory, OperationalJobType, type OperationalJobRecord } from "@sport-os/platform";
import type { SupabaseClient } from "@sport-os/platform";
import { buildPerformanceLedgerEntry, LedgerMode, SettlementStatus, type PerformanceRecordInput } from "@sport-os/settlement-engine";
import type { SupabasePerformanceLedgerRepository } from "../db/repositories.js";
import type { JobHandler, JobHandlerResult } from "./worker.js";

/**
 * PERFORMANCE_SNAPSHOT (Section 11 Part F). Closes the real gap
 * `OPEN_QUESTIONS.md` #25 already flagged for Section 09: Section 08
 * built the real `settlements`/`settlement_legs` schema and the real
 * `buildPerformanceLedgerEntry()` aggregation, but NOTHING ever wrote a
 * row to `performance_ledger` from them — `PerformanceAgent` only
 * aggregates whatever `Settlement[]` a caller hands it in memory. This
 * handler is the first thing that actually reads the real `settlements`
 * table and persists a real `performance_ledger` snapshot from it —
 * pure persistence/orchestration over an ALREADY-REAL aggregation
 * function, never a second one.
 *
 * Deliberately bounded scope: breaks out by `(ledgerMode, ticketType)`
 * only — `sport` is hardcoded to `"football"` because no other sport's
 * settlements are ever persisted to this schema today (Aviator has no
 * persistence at all — `OPEN_QUESTIONS.md` #26), and `league`/`market`/
 * `modelVersion`/`decisionPolicyVersion` stay unbroken-out (`undefined`,
 * meaning "not broken out by this axis," never "unknown" — see
 * `PerformanceLedgerEntry`'s own doc comment) since resolving those
 * would require joining through `ticket_legs`/`decisions`/
 * `value_evaluations` as well, out of scope for this handler's first,
 * honest version — see `OPEN_QUESTIONS.md`'s new entry on this.
 */
export class PerformanceSnapshotJobHandler implements JobHandler {
  readonly jobType: OperationalJobType = OperationalJobType.PERFORMANCE_SNAPSHOT;

  constructor(
    private readonly client: SupabaseClient,
    private readonly ledgerRepo: SupabasePerformanceLedgerRepository,
  ) {}

  async handle(job: OperationalJobRecord): Promise<JobHandlerResult> {
    const periodStart = job.payloadReference.periodStart as string | undefined;
    const periodEnd = job.payloadReference.periodEnd as string | undefined;
    if (!periodStart || !periodEnd) {
      return { ok: false, category: JobFailureCategory.INVALID_PAYLOAD, message: "payloadReference.periodStart/periodEnd are required." };
    }

    const { data: settlementRows, error: settlementsError } = await this.client
      .from("settlements")
      .select("id, ticket_id, status, ledger_mode, actual_stake_amount, actual_stake_currency, actual_payout_amount, actual_payout_currency, settled_at")
      .gte("settled_at", periodStart)
      .lte("settled_at", periodEnd);
    if (settlementsError) {
      return { ok: false, category: JobFailureCategory.TRANSIENT_DEPENDENCY_FAILURE, message: `Failed to query settlements: ${settlementsError.message}` };
    }
    const settlements = (settlementRows ?? []) as readonly {
      readonly id: string;
      readonly ticket_id: string;
      readonly status: string;
      readonly ledger_mode: string;
      readonly actual_stake_amount: number | null;
      readonly actual_stake_currency: string | null;
      readonly actual_payout_amount: number | null;
      readonly actual_payout_currency: string | null;
      readonly settled_at: string | null;
    }[];
    if (settlements.length === 0) {
      return { ok: true };
    }

    const ticketIds = [...new Set(settlements.map((s) => s.ticket_id))];
    const { data: ticketRows, error: ticketsError } = await this.client.from("tickets").select("id, ticket_type").in("id", ticketIds);
    if (ticketsError) {
      return { ok: false, category: JobFailureCategory.TRANSIENT_DEPENDENCY_FAILURE, message: `Failed to query tickets: ${ticketsError.message}` };
    }
    const ticketTypeById = new Map((ticketRows ?? []).map((row) => [row.id as string, row.ticket_type as string]));

    const settlementIds = settlements.map((s) => s.id);
    const { data: legRows, error: legsError } = await this.client.from("settlement_legs").select("settlement_id").in("settlement_id", settlementIds);
    if (legsError) {
      return { ok: false, category: JobFailureCategory.TRANSIENT_DEPENDENCY_FAILURE, message: `Failed to query settlement_legs: ${legsError.message}` };
    }
    const legCountBySettlementId = new Map<string, number>();
    for (const row of legRows ?? []) {
      const id = row.settlement_id as string;
      legCountBySettlementId.set(id, (legCountBySettlementId.get(id) ?? 0) + 1);
    }

    const groups = new Map<string, { readonly ledgerMode: LedgerMode; readonly ticketType: string | undefined; readonly records: PerformanceRecordInput[] }>();
    for (const settlement of settlements) {
      const ticketType = ticketTypeById.get(settlement.ticket_id);
      const key = `${settlement.ledger_mode}:${ticketType ?? ""}`;
      if (!groups.has(key)) {
        groups.set(key, { ledgerMode: settlement.ledger_mode as LedgerMode, ticketType, records: [] });
      }
      groups.get(key)!.records.push({
        status: settlement.status as SettlementStatus,
        ledgerMode: settlement.ledger_mode as LedgerMode,
        legCount: legCountBySettlementId.get(settlement.id) ?? 1,
        executed: settlement.actual_stake_amount !== null,
        actualStake: settlement.actual_stake_amount !== null && settlement.actual_stake_currency !== null ? { amount: settlement.actual_stake_amount, currency: settlement.actual_stake_currency } : null,
        actualPayout: settlement.actual_payout_amount !== null && settlement.actual_payout_currency !== null ? { amount: settlement.actual_payout_amount, currency: settlement.actual_payout_currency } : null,
        // No value_evaluations/decisions join in this first version — never fabricated, see the class doc comment.
        expectedEv: undefined,
        settledAt: settlement.settled_at,
      });
    }

    for (const group of groups.values()) {
      const entry = buildPerformanceLedgerEntry({
        records: group.records,
        periodStart,
        periodEnd,
        ledgerMode: group.ledgerMode,
        sport: "football",
        ...(group.ticketType !== undefined ? { ticketType: group.ticketType } : {}),
      });
      await this.ledgerRepo.upsert(entry);
    }

    return { ok: true };
  }
}
