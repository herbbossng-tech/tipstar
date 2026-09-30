import { ValidationError } from "@sport-os/shared";
import type { Money } from "./types.js";

/**
 * Financial accounting primitives (Section 08 §17/§44). Pure, currency-
 * safe arithmetic over `Money` — no I/O, no randomness. "Do not aggregate
 * NGN/KES/GHS/etc. into one numerical P&L without an explicit FX
 * conversion layer... never silently convert." No FX layer exists in
 * this codebase, so every function here refuses (throws) rather than
 * silently combining two different currencies.
 */

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError({
      message: `Cannot combine ${a.currency} and ${b.currency} without an FX conversion layer.`,
      code: "CURRENCY_MISMATCH",
      context: { a: a.currency, b: b.currency },
    });
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

/** Sums a list of same-currency amounts — throws on the first mismatched currency (never silently drops or converts one). `undefined` for an empty list (there is no "zero of no currency"). */
export function sumMoney(amounts: readonly Money[]): Money | undefined {
  if (amounts.length === 0) return undefined;
  return amounts.slice(1).reduce((sum, m) => addMoney(sum, m), amounts[0]!);
}

/**
 * net_pnl = actual_payout - actual_stake (§17). `null` — never `0` — when
 * either side is unknown: an unexecuted ticket has NO actual financial
 * P&L, which is a distinct state from a real, computed zero.
 */
export function computeNetPnl(actualStake: Money | null, actualPayout: Money | null): Money | null {
  if (actualStake === null || actualPayout === null) return null;
  return subtractMoney(actualPayout, actualStake);
}

/**
 * ROI = net_pnl / actual_stake, only when actual_stake > 0 (§17/§25).
 * `null` — never `Infinity`/`NaN` — for a zero or unknown stake.
 */
export function computeRoi(netPnl: Money | null, actualStake: Money | null): number | null {
  if (netPnl === null || actualStake === null || !(actualStake.amount > 0)) return null;
  assertSameCurrency(netPnl, actualStake);
  return netPnl.amount / actualStake.amount;
}
