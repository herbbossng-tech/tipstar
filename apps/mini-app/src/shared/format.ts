import type { Money } from "../api/types.js";

/**
 * Pure display-formatting helpers (Section 09 §25/§26 — Financial
 * Display Rule / Currency Display). "If actual stake = NULL, do not
 * display ₦0 stake... never convert NULL into zero in the UI." Every
 * function here takes an explicit `fallback` for the null case rather
 * than silently defaulting to "0" — a caller must decide the honest
 * label for its context ("Not executed", "Pending", "Unavailable").
 */

export function formatMoney(money: Money | null, fallback: string): string {
  if (money === null) return fallback;
  // Intl.NumberFormat with an unknown/unsupported ISO code throws — fall
  // back to a plain "<code> <amount>" render rather than crashing the
  // screen over a currency Intl doesn't recognize (§26: never perform FX
  // conversion or silently drop the currency — this only changes how the
  // SAME currency is displayed, never which one).
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: money.currency, currencyDisplay: "code" }).format(money.amount);
  } catch {
    return `${money.currency} ${money.amount.toFixed(2)}`;
  }
}

export function formatPercent(value: number | null, fallback = "—"): string {
  if (value === null) return fallback;
  return `${(value * 100).toFixed(1)}%`;
}

/** For a probability already expressed as 0-1 (e.g. model probability) — always labeled by the caller as "Model probability", never bare "%". */
export function formatProbability(value: number | null, fallback = "—"): string {
  return formatPercent(value, fallback);
}

export function formatOdds(value: number | null, fallback = "—"): string {
  if (value === null) return fallback;
  return value.toFixed(2);
}

export function formatSignedPercent(value: number | null, fallback = "—"): string {
  if (value === null) return fallback;
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatDateTime(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(iso: string | null, fallback = "—"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

const MARKET_TYPE_LABELS: Readonly<Record<string, string>> = {
  match_result_1x2: "Match Result",
  over_under: "Over/Under",
  both_teams_to_score: "Both Teams to Score",
  double_chance: "Double Chance",
  team_totals: "Team Totals",
  asian_handicap: "Asian Handicap",
  european_handicap: "European Handicap",
  corners: "Corners",
  cards: "Cards",
  correct_score: "Correct Score",
  first_half: "1st Half",
  second_half: "2nd Half",
};

/** A human-readable market label (Section 09 §14 — never a bare enum string in the UI). Unrecognized market types render their raw value rather than disappearing — still factual, never hidden. */
export function formatMarketLabel(marketType: string, selection: string, line: number | null): string {
  const marketLabel = MARKET_TYPE_LABELS[marketType] ?? marketType;
  const lineSuffix = line !== null ? ` ${line}` : "";
  return `${marketLabel}${lineSuffix} — ${selection}`;
}

/** Minutes since `iso` — used to flag stale odds/predictions (Section 09 §49/§50: "do not make old data look live"). `null` for an unparseable/missing timestamp. */
export function minutesSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.round((now.getTime() - then) / 60000));
}
