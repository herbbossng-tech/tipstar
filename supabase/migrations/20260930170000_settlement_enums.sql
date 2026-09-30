-- Section 08 — Settlement + Performance + Backtesting. Enum types
-- mirroring the TypeScript `as const` unions this section introduced
-- exactly (defense-in-depth mirror, same rationale as every prior
-- section's own enums file — the TypeScript types remain the single
-- source of truth):
--   SettlementStatus  @sport-os/settlement-engine/src/types.ts
--   LedgerMode        @sport-os/settlement-engine/src/types.ts
--   PayoutSource      @sport-os/settlement-engine/src/types.ts
--
-- `public.training_run_status` (Section 05, already 'running'/
-- 'completed'/'failed') is reused directly for `backtest_runs.status`
-- below — never duplicated into a near-identical new enum.

create type public.settlement_status as enum ('WON', 'LOST', 'VOID', 'PUSH', 'PENDING', 'CANCELLED');

create type public.ledger_mode as enum ('PAPER', 'LIVE');

create type public.payout_source as enum ('PROVIDER', 'CALCULATED');
