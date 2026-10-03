// Settlement-revision folding for Supabase Edge Functions (Deno
// runtime) — Section 09. Mirrors `@sport-os/settlement-engine`'s
// `resolveCurrentSettlement()` exactly (packages/settlement-engine/src/
// revisions.ts): Deno cannot import that npm workspace package directly
// without a bundling step, so the fold logic is re-implemented here —
// keep both in sync if either changes. This is presentation-layer
// folding only (which row is "current"), never a settlement calculation
// — the underlying settlement math stays exclusively in
// `@sport-os/football-engine`'s `settleTicket()`.

export interface SettlementRevisionRow {
  readonly new_status: string;
  readonly new_payout_amount: number | null;
  readonly new_payout_currency: string | null;
  readonly created_at: string;
}

export interface EffectiveSettlementStatus {
  readonly status: string;
  readonly payoutAmount: number | null;
  readonly payoutCurrency: string | null;
  readonly revisionCount: number;
  readonly lastRevisedAt: string | undefined;
}

/** `revisions` must already be filtered to one `original_settlement_id` — this function does not filter. Order is irrelevant here (only the greatest `created_at` matters), unlike the TS original, which assumes pre-sorted input; sorting defensively keeps this safe even if a caller forgets. */
export function resolveEffectiveSettlement(originalStatus: string, originalPayoutAmount: number | null, originalPayoutCurrency: string | null, revisions: readonly SettlementRevisionRow[]): EffectiveSettlementStatus {
  if (revisions.length === 0) {
    return { status: originalStatus, payoutAmount: originalPayoutAmount, payoutCurrency: originalPayoutCurrency, revisionCount: 0, lastRevisedAt: undefined };
  }
  const sorted = [...revisions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const last = sorted[sorted.length - 1]!;
  return { status: last.new_status, payoutAmount: last.new_payout_amount, payoutCurrency: last.new_payout_currency, revisionCount: sorted.length, lastRevisedAt: last.created_at };
}
