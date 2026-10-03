/**
 * Telegram message template engine (Section 10 §15-17, §23-25, §34-36,
 * §54). Every render function here is a PURE, DETERMINISTIC string
 * builder: the same input always produces the same text, and nothing is
 * mutated on the way in. Every value comes from the caller as an
 * already-finalized field — this module never computes probability,
 * odds, EV, edge, settlement status, or P&L; it only formats them, and
 * it never relabels anything as "BEST BET"/"SURE WIN"/"BANKER"/"LOCK"/
 * "FIXED"/"GUARANTEED" (§15/§65 — factual language only).
 *
 * Every dynamic string (team names, league names, reasons, booking
 * codes) is HTML-escaped before interpolation — a team name containing
 * `&`, `<`, `>`, or a quote can never break the message's HTML markup
 * (`parseMode: "HTML"` is used for every rendered message — see
 * `service.ts`'s `SendMessageOptions`).
 */

export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface RenderedMessage {
  readonly text: string;
  readonly templateVersion: string;
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatOdds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}

function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatMoney(value: { readonly amount: number; readonly currency: string } | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return `${value.currency} ${value.amount.toFixed(2)}`;
}

const MARKET_LABELS: Readonly<Record<string, string>> = {
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

function marketLabel(marketType: string, line: number | null | undefined): string {
  const label = MARKET_LABELS[marketType] ?? marketType;
  return line !== null && line !== undefined ? `${label} ${line}` : label;
}

// ---- Sport Agent Card / Individual Pick (§15/§16) ----

export interface PickCardInput {
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly competition: string | undefined;
  readonly marketType: string;
  readonly selection: string;
  readonly line: number | undefined;
  readonly modelProbability: number | null;
  readonly marketOdds: number | null;
  readonly fairOdds: number | null;
  readonly edge: number | null;
  readonly expectedValue: number | null;
  readonly decision: string;
  readonly modelVersion: string | undefined;
  readonly dataTimestamp: string;
  readonly policyVersion: string;
}

const PICK_TEMPLATE_VERSION = "pick_v1";

/** Individual Pick Card (§16) — every figure its own labeled line, never collapsed into an "AI confidence" number. */
export function renderPickMessage(input: PickCardInput): RenderedMessage {
  const lines = [
    `<b>${escapeTelegramHtml(input.homeTeam)} vs ${escapeTelegramHtml(input.awayTeam)}</b>`,
    input.competition ? escapeTelegramHtml(input.competition) : undefined,
    "",
    `Market: ${escapeTelegramHtml(marketLabel(input.marketType, input.line))}`,
    `Selection: ${escapeTelegramHtml(input.selection)}`,
    `Market odds: ${formatOdds(input.marketOdds)}`,
    `Model probability: ${formatProbability(input.modelProbability)}`,
    `Fair odds: ${formatOdds(input.fairOdds)}`,
    `Edge: ${formatSigned(input.edge)}`,
    `Expected value: ${formatSigned(input.expectedValue)}`,
    `Decision: ${escapeTelegramHtml(input.decision)}`,
    "",
    `<i>Model ${input.modelVersion ? escapeTelegramHtml(input.modelVersion) : "—"} · Policy ${escapeTelegramHtml(input.policyVersion)} · ${escapeTelegramHtml(input.dataTimestamp)}</i>`,
  ].filter((line): line is string => line !== undefined);
  return { text: lines.join("\n"), templateVersion: PICK_TEMPLATE_VERSION };
}

// ---- Ticket Card (§17) ----

export interface TicketCardLegInput {
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly marketType: string;
  readonly selection: string;
  readonly line: number | undefined;
  readonly odds: number;
}

export interface TicketCardInput {
  readonly ticketType: "SINGLE" | "ACCUMULATOR";
  readonly legs: readonly TicketCardLegInput[];
  readonly combinedOdds: number | null;
  readonly stake: number | null;
  readonly currency: string | undefined;
}

const TICKET_TEMPLATE_VERSION = "ticket_v1";

function renderLegLine(leg: TicketCardLegInput, index: number | undefined): string {
  const prefix = index !== undefined ? `${index}. ` : "";
  return `${prefix}${escapeTelegramHtml(leg.homeTeam)} vs ${escapeTelegramHtml(leg.awayTeam)} — ${escapeTelegramHtml(marketLabel(leg.marketType, leg.line))} — ${escapeTelegramHtml(leg.selection)} @ ${formatOdds(leg.odds)}`;
}

/** Ticket Card (§17) — an accumulator is ONE ticket, N legs: always a single header line naming the real leg count, then one numbered line per leg. Never rendered as N separate ticket messages. */
export function renderTicketMessage(input: TicketCardInput): RenderedMessage {
  const header = input.ticketType === "ACCUMULATOR" ? `<b>ACCUMULATOR · ${input.legs.length} LEGS</b>` : "<b>SINGLE</b>";
  const legLines = input.legs.map((leg, i) => renderLegLine(leg, input.ticketType === "ACCUMULATOR" ? i + 1 : undefined));
  const footer = [`Combined odds: ${formatOdds(input.combinedOdds)}`, input.stake !== null ? `Stake: ${input.currency ?? ""} ${input.stake.toFixed(2)}`.trim() : "Stake: not executed"];
  const text = [header, "", ...legLines, "", ...footer].join("\n");
  return { text, templateVersion: TICKET_TEMPLATE_VERSION };
}

// ---- Booking Code (§18/§75) ----

export interface BookingCodeInput {
  readonly bookingCode: string | undefined;
  readonly provider: string | undefined;
}

const BOOKING_CODE_TEMPLATE_VERSION = "booking_code_v1";

/** §18 — never derives or invents a booking code. `bookingCode: undefined` always renders the honest "unavailable" line; the caller's own policy check (`BOOKING_CODE_UNAVAILABLE`) decides whether this message is even sent at all. */
export function renderBookingCodeMessage(input: BookingCodeInput): RenderedMessage {
  const text = input.bookingCode
    ? [`<b>Booking code</b>`, escapeTelegramHtml(input.bookingCode), input.provider ? `<i>${escapeTelegramHtml(input.provider)}</i>` : undefined].filter((l): l is string => l !== undefined).join("\n")
    : "<b>BOOKING CODE UNAVAILABLE</b>";
  return { text, templateVersion: BOOKING_CODE_TEMPLATE_VERSION };
}

// ---- Result Message (§23/§24/§25) ----

export interface ResultLegInput {
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly marketType: string;
  readonly selection: string;
  readonly status: string;
}

export interface ResultMessageInput {
  readonly ticketType: "SINGLE" | "ACCUMULATOR";
  /** The real, EFFECTIVE ticket-level settlement status (after folding any revisions) — never re-derived from the legs here. */
  readonly ticketStatus: string;
  readonly legs: readonly ResultLegInput[];
  readonly actualPayout: { readonly amount: number; readonly currency: string } | null;
  readonly netPnl: { readonly amount: number; readonly currency: string } | null;
  readonly wasRevised: boolean;
}

const RESULT_TEMPLATE_VERSION = "result_v1";

/** Result Message (§23/§24) — "5-leg accumulator = ONE losing ticket," never "1 loss" five times. NULL financial fields stay NULL (rendered as "Not available"), never coerced to zero. */
export function renderResultMessage(input: ResultMessageInput): RenderedMessage {
  const legLines = input.legs.map((leg) => `${escapeTelegramHtml(leg.homeTeam)} vs ${escapeTelegramHtml(leg.awayTeam)} — ${escapeTelegramHtml(marketLabel(leg.marketType, undefined))} ${escapeTelegramHtml(leg.selection)}: ${escapeTelegramHtml(leg.status)}`);
  const lines = [
    `<b>Ticket: ${escapeTelegramHtml(input.ticketStatus)}</b>`,
    "",
    ...legLines,
    "",
    `Payout: ${formatMoney(input.actualPayout, "Not available")}`,
    `Net P&amp;L: ${formatMoney(input.netPnl, "Not available")}`,
    input.wasRevised ? "<i>This settlement was revised.</i>" : undefined,
  ].filter((line): line is string => line !== undefined);
  return { text: lines.join("\n"), templateVersion: RESULT_TEMPLATE_VERSION };
}

// ---- Performance Message (§54) ----

export interface PerformanceMessageInput {
  readonly ledgerMode: "LIVE" | "PAPER";
  readonly periodLabel: string;
  readonly netPnl: { readonly amount: number; readonly currency: string } | null;
  readonly roi: number | null;
  readonly sampleSize: number;
  readonly wins: number;
  readonly losses: number;
}

const PERFORMANCE_TEMPLATE_VERSION = "performance_v1";

/** §54 — renders only canonical, already-aggregated performance figures (`performance_ledger`); computes no aggregation itself. */
export function renderPerformanceMessage(input: PerformanceMessageInput): RenderedMessage {
  const text = [
    `<b>Performance (${input.ledgerMode}) — ${escapeTelegramHtml(input.periodLabel)}</b>`,
    "",
    `Net P&amp;L: ${formatMoney(input.netPnl, "Not available")}`,
    `ROI: ${input.roi === null ? "Not available" : formatSigned(input.roi)}`,
    `Wins: ${input.wins} · Losses: ${input.losses}`,
    `Sample size: ${input.sampleSize}`,
  ].join("\n");
  return { text, templateVersion: PERFORMANCE_TEMPLATE_VERSION };
}
