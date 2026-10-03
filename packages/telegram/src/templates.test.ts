import { describe, expect, it } from "vitest";
import { escapeTelegramHtml, renderBookingCodeMessage, renderPickMessage, renderResultMessage, renderTicketMessage } from "./templates.js";

describe("escapeTelegramHtml — Section 10 Telegram formatting", () => {
  it("escapes &, <, >, and \" so dynamic text can never break the HTML message structure", () => {
    expect(escapeTelegramHtml(`AC Milan & Inter <script>"x"</script>`)).toBe("AC Milan &amp; Inter &lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  });

  it("leaves apostrophes, underscores, and asterisks untouched — this is HTML parse_mode, not Markdown, so those characters are not special here", () => {
    expect(escapeTelegramHtml("O'Brien_Utd * Star_FC")).toBe("O'Brien_Utd * Star_FC");
  });

  it("passes emoji and long names straight through, unescaped and unmodified", () => {
    const longName = "A".repeat(200) + " 🔥⚽️";
    expect(escapeTelegramHtml(longName)).toBe(longName);
  });
});

describe("renderTicketMessage — Section 10 §17 (an accumulator is ONE ticket, N legs)", () => {
  const leg = (home: string, away: string) => ({ homeTeam: home, awayTeam: away, marketType: "match_result_1x2", selection: "HOME", line: undefined, odds: 1.8 });

  it("renders a 5-leg accumulator as a single message with a real leg count and numbered legs 1-5 — never 5 separate messages", () => {
    const rendered = renderTicketMessage({ ticketType: "ACCUMULATOR", legs: [leg("A", "B"), leg("C", "D"), leg("E", "F"), leg("G", "H"), leg("I", "J")], combinedOdds: 12.3, stake: 10, currency: "USD" });
    expect(rendered.text).toContain("ACCUMULATOR · 5 LEGS");
    for (let i = 1; i <= 5; i++) expect(rendered.text).toContain(`${i}. `);
    expect(rendered.text.split("\n").filter((line) => /vs/.test(line))).toHaveLength(5);
  });

  it("renders a SINGLE with no leg numbering", () => {
    const rendered = renderTicketMessage({ ticketType: "SINGLE", legs: [leg("A", "B")], combinedOdds: 1.8, stake: 10, currency: "USD" });
    expect(rendered.text).toContain("SINGLE");
    expect(rendered.text).not.toContain("1. ");
  });

  it("never fabricates a stake for an unexecuted ticket — NULL stays NULL, rendered honestly, never coerced to 0.00", () => {
    const rendered = renderTicketMessage({ ticketType: "SINGLE", legs: [leg("A", "B")], combinedOdds: 1.8, stake: null, currency: undefined });
    expect(rendered.text).toContain("Stake: not executed");
    expect(rendered.text).not.toContain("0.00");
  });

  it("HTML-escapes a team name containing &, <, > so it can never break the published message", () => {
    const rendered = renderTicketMessage({ ticketType: "SINGLE", legs: [leg("AC Milan & Co", "<Inter>")], combinedOdds: 1.8, stake: 10, currency: "USD" });
    expect(rendered.text).toContain("AC Milan &amp; Co");
    expect(rendered.text).toContain("&lt;Inter&gt;");
    expect(rendered.text).not.toContain("<Inter>");
  });

  it("is stamped with a stable template version (ticket_v1) for later correction tracking", () => {
    expect(renderTicketMessage({ ticketType: "SINGLE", legs: [leg("A", "B")], combinedOdds: 1.8, stake: 10, currency: "USD" }).templateVersion).toBe("ticket_v1");
  });
});

describe("renderPickMessage — Section 10 §16 (distinct fields, never a collapsed 'confidence')", () => {
  it("renders probability, odds, fair odds, edge, and EV as separate labeled lines — never merged into one number", () => {
    const rendered = renderPickMessage({
      homeTeam: "A",
      awayTeam: "B",
      competition: "EPL",
      marketType: "match_result_1x2",
      selection: "HOME",
      line: undefined,
      modelProbability: 0.62,
      marketOdds: 1.9,
      fairOdds: 1.61,
      edge: 0.05,
      expectedValue: 0.08,
      decision: "VALUE",
      modelVersion: "v3",
      dataTimestamp: "2026-06-01T00:00:00Z",
      policyVersion: "policy_v1",
    });
    expect(rendered.text).toContain("Model probability: 62.0%");
    expect(rendered.text).toContain("Market odds: 1.90");
    expect(rendered.text).toContain("Fair odds: 1.61");
    expect(rendered.text).toContain("Edge: +5.0%");
    expect(rendered.text).not.toMatch(/confidence/i);
  });

  it("never prints BEST BET/SURE WIN/BANKER/LOCK/FIXED/GUARANTEED — factual decision label only", () => {
    const rendered = renderPickMessage({
      homeTeam: "A",
      awayTeam: "B",
      competition: undefined,
      marketType: "match_result_1x2",
      selection: "HOME",
      line: undefined,
      modelProbability: 0.62,
      marketOdds: 1.9,
      fairOdds: 1.61,
      edge: 0.05,
      expectedValue: 0.08,
      decision: "VALUE",
      modelVersion: undefined,
      dataTimestamp: "2026-06-01T00:00:00Z",
      policyVersion: "policy_v1",
    });
    for (const forbidden of ["BEST BET", "SURE WIN", "BANKER", "LOCK", "FIXED", "GUARANTEED"]) {
      expect(rendered.text.toUpperCase()).not.toContain(forbidden);
    }
  });
});

describe("renderBookingCodeMessage — Section 10 §18/§75", () => {
  it("renders the real booking code when one exists", () => {
    expect(renderBookingCodeMessage({ bookingCode: "ABC123", provider: "SportyBet" }).text).toContain("ABC123");
  });

  it("renders 'BOOKING CODE UNAVAILABLE' when none exists — never derives or guesses one", () => {
    const rendered = renderBookingCodeMessage({ bookingCode: undefined, provider: undefined });
    expect(rendered.text).toBe("<b>BOOKING CODE UNAVAILABLE</b>");
  });
});

describe("renderResultMessage — Section 10 §23/§24/§25", () => {
  const leg = (status: string) => ({ homeTeam: "A", awayTeam: "B", marketType: "match_result_1x2", selection: "HOME", status });

  it("shows a 5-leg accumulator as ONE ticket-level result line, never '1 loss' repeated five times", () => {
    const rendered = renderResultMessage({ ticketType: "ACCUMULATOR", ticketStatus: "LOST", legs: [leg("WON"), leg("WON"), leg("LOST"), leg("WON"), leg("WON")], actualPayout: null, netPnl: { amount: -10, currency: "USD" }, wasRevised: false });
    expect(rendered.text.match(/Ticket: LOST/g)).toHaveLength(1);
    expect(rendered.text.split("\n").filter((line) => /vs/.test(line))).toHaveLength(5);
  });

  it("never coerces a NULL payout to 0.00 — renders 'Not available' instead", () => {
    const rendered = renderResultMessage({ ticketType: "SINGLE", ticketStatus: "VOID", legs: [leg("VOID")], actualPayout: null, netPnl: null, wasRevised: false });
    expect(rendered.text).toContain("Payout: Not available");
    expect(rendered.text).toContain("Net P&amp;L: Not available");
    expect(rendered.text).not.toContain("0.00");
  });

  it("renders a real actual payout when one exists", () => {
    const rendered = renderResultMessage({ ticketType: "SINGLE", ticketStatus: "WON", legs: [leg("WON")], actualPayout: { amount: 18.5, currency: "USD" }, netPnl: { amount: 8.5, currency: "USD" }, wasRevised: false });
    expect(rendered.text).toContain("Payout: USD 18.50");
  });

  it("flags a revised settlement explicitly rather than silently rewriting history", () => {
    const rendered = renderResultMessage({ ticketType: "SINGLE", ticketStatus: "WON", legs: [leg("WON")], actualPayout: { amount: 18.5, currency: "USD" }, netPnl: { amount: 8.5, currency: "USD" }, wasRevised: true });
    expect(rendered.text).toContain("This settlement was revised.");
  });
});
