import { MarketType } from "@sport-os/market-engine";
import { ValidationError } from "@sport-os/shared";
import { describe, expect, it } from "vitest";
import { DecisionOutcome, ValueEligibility, VALUE_CALCULATION_VERSION, type ValueAssessment } from "./decision.js";
import {
  authorizeTicketStake,
  computeCombinedOdds,
  computeCombinedProbability,
  createTicketDraft,
  deriveTicketType,
  ticketLegFromValueAssessment,
  TicketStatus,
  TicketType,
  TicketValidationFailureCode,
  transitionTicketStatus,
  validateTicket,
  type TicketConstraints,
} from "./ticket-engine.js";

const NOW = "2026-01-10T18:00:00Z";

function betAssessment(overrides: Partial<ValueAssessment> = {}): ValueAssessment {
  return {
    eventId: "fixture-1",
    marketType: MarketType.MATCH_RESULT_1X2,
    selection: "HOME",
    line: undefined,
    calibratedProbability: 0.6,
    marketOdds: 2.2,
    fairOdds: 1 / 0.6,
    edge: 0.6 - 1 / 2.2,
    expectedValue: 0.6 * 2.2 - 1,
    dataQuality: "AVAILABLE",
    oddsTimestamp: "2026-01-10T17:59:00Z",
    modelVersion: "model-v1",
    calculationVersion: VALUE_CALCULATION_VERSION,
    eligibility: ValueEligibility.VALID,
    decision: DecisionOutcome.BET,
    reasons: [],
    evaluatedAt: NOW,
    qualifies: true,
    ...overrides,
  };
}

describe("ticketLegFromValueAssessment", () => {
  it("builds a leg from a real BET assessment", () => {
    const leg = ticketLegFromValueAssessment(betAssessment());
    expect(leg.fixtureId).toBe("fixture-1");
    expect(leg.probability).toBe(0.6);
    expect(leg.odds).toBe(2.2);
    expect(leg.leakageFlag).toBe(false);
  });

  it("refuses to build a leg from an assessment with no probability/odds — never fabricates a leg", () => {
    expect(() => ticketLegFromValueAssessment(betAssessment({ calibratedProbability: null }))).toThrow(ValidationError);
    expect(() => ticketLegFromValueAssessment(betAssessment({ marketOdds: null }))).toThrow(ValidationError);
  });
});

describe("computeCombinedOdds / computeCombinedProbability — accumulator math", () => {
  it("a SINGLE leg's combined odds/probability equal the leg's own values", () => {
    const leg = ticketLegFromValueAssessment(betAssessment());
    expect(computeCombinedOdds([leg])).toBeCloseTo(2.2, 4);
    expect(computeCombinedProbability([leg])?.value).toBeCloseTo(0.6, 6);
  });

  it("a 3-leg accumulator's combined odds are the exact product of leg odds", () => {
    const legs = [ticketLegFromValueAssessment(betAssessment({ eventId: "f1", marketOdds: 2.0 })), ticketLegFromValueAssessment(betAssessment({ eventId: "f2", marketOdds: 1.5 })), ticketLegFromValueAssessment(betAssessment({ eventId: "f3", marketOdds: 3.0 }))];
    expect(computeCombinedOdds(legs)).toBeCloseTo(2.0 * 1.5 * 3.0, 4);
  });

  it("combined probability is EXPLICITLY tagged with the independence assumption, never presented as exact (§18)", () => {
    const legs = [ticketLegFromValueAssessment(betAssessment({ eventId: "f1", calibratedProbability: 0.5 })), ticketLegFromValueAssessment(betAssessment({ eventId: "f2", calibratedProbability: 0.4 }))];
    const combined = computeCombinedProbability(legs);
    expect(combined?.value).toBeCloseTo(0.2, 6);
    expect(combined?.method).toBe("independence_assumption");
    expect(combined?.calculationVersion).toBeTruthy();
  });
});

describe("deriveTicketType", () => {
  it("1 leg is SINGLE, 2+ legs is ACCUMULATOR — never counts legs as separate tickets", () => {
    expect(deriveTicketType(1)).toBe(TicketType.SINGLE);
    expect(deriveTicketType(2)).toBe(TicketType.ACCUMULATOR);
    expect(deriveTicketType(5)).toBe(TicketType.ACCUMULATOR);
  });
});

describe("createTicketDraft", () => {
  it("a 5-leg accumulator is ONE TicketRecord, not 5", () => {
    const legs = Array.from({ length: 5 }, (_, i) => ticketLegFromValueAssessment(betAssessment({ eventId: `fixture-${i}` })));
    const ticket = createTicketDraft({ legs, createdBy: "agent-1", now: () => NOW });
    expect(ticket.ticketType).toBe(TicketType.ACCUMULATOR);
    expect(ticket.legs).toHaveLength(5);
    expect(typeof ticket.ticketId).toBe("string");
  });

  it("starts in DRAFT with no stake/potentialReturn — never invents a stake", () => {
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    expect(ticket.status).toBe(TicketStatus.DRAFT);
    expect(ticket.stake).toBeUndefined();
    expect(ticket.potentialReturn).toBeUndefined();
    expect(ticket.version).toBe(1);
  });

  it("refuses to create a ticket with zero legs", () => {
    expect(() => createTicketDraft({ legs: [], createdBy: "agent-1" })).toThrow(ValidationError);
  });

  it("records model lineage per leg", () => {
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    expect(ticket.modelLineage).toEqual([{ fixtureId: "fixture-1", modelVersion: "model-v1", calculationVersion: VALUE_CALCULATION_VERSION }]);
  });
});

describe("transitionTicketStatus — immutable versioning (§16, §34)", () => {
  it("produces a NEW object with an incremented version — never mutates the original", () => {
    const original = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    const proposed = transitionTicketStatus(original, TicketStatus.PROPOSED, "2026-01-10T18:01:00Z");
    expect(proposed).not.toBe(original);
    expect(proposed.version).toBe(2);
    expect(original.version).toBe(1);
    expect(original.status).toBe(TicketStatus.DRAFT); // the original is UNCHANGED
    expect(proposed.status).toBe(TicketStatus.PROPOSED);
  });

  it("follows the documented state machine: DRAFT -> PROPOSED -> VALIDATED -> AUTHORIZED -> EXECUTING -> EXECUTED", () => {
    let ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    ticket = transitionTicketStatus(ticket, TicketStatus.PROPOSED, NOW);
    ticket = transitionTicketStatus(ticket, TicketStatus.VALIDATED, NOW);
    ticket = transitionTicketStatus(ticket, TicketStatus.AUTHORIZED, NOW, { stake: 10 });
    ticket = transitionTicketStatus(ticket, TicketStatus.EXECUTING, NOW);
    ticket = transitionTicketStatus(ticket, TicketStatus.EXECUTED, NOW);
    expect(ticket.status).toBe(TicketStatus.EXECUTED);
    expect(ticket.version).toBe(6);
  });

  it("rejects a transition not in the state machine — e.g. DRAFT straight to EXECUTED", () => {
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    expect(() => transitionTicketStatus(ticket, TicketStatus.EXECUTED, NOW)).toThrow(ValidationError);
  });

  it("rejects a transition out of a terminal state (EXECUTED/REJECTED/CANCELLED)", () => {
    let ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    ticket = transitionTicketStatus(ticket, TicketStatus.CANCELLED, NOW);
    expect(() => transitionTicketStatus(ticket, TicketStatus.PROPOSED, NOW)).toThrow(ValidationError);
  });
});

describe("authorizeTicketStake — the ONLY place stake enters a ticket", () => {
  it("sets a real stake and computes potentialReturn from the real combined odds", () => {
    let ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment({ marketOdds: 2.0 }))], createdBy: "agent-1", now: () => NOW });
    ticket = transitionTicketStatus(ticket, TicketStatus.PROPOSED, NOW);
    ticket = transitionTicketStatus(ticket, TicketStatus.VALIDATED, NOW);
    const authorized = authorizeTicketStake(ticket, 25, NOW);
    expect(authorized.stake).toBe(25);
    expect(authorized.potentialReturn).toBeCloseTo(50, 2);
    expect(authorized.status).toBe(TicketStatus.AUTHORIZED);
  });

  it("rejects a non-positive stake", () => {
    let ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    ticket = transitionTicketStatus(ticket, TicketStatus.PROPOSED, NOW);
    ticket = transitionTicketStatus(ticket, TicketStatus.VALIDATED, NOW);
    expect(() => authorizeTicketStake(ticket, 0, NOW)).toThrow(ValidationError);
    expect(() => authorizeTicketStake(ticket, -5, NOW)).toThrow(ValidationError);
  });

  it("cannot authorize a stake on a DRAFT ticket — must go through VALIDATED first", () => {
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(betAssessment())], createdBy: "agent-1", now: () => NOW });
    expect(() => authorizeTicketStake(ticket, 10, NOW)).toThrow(ValidationError);
  });
});

describe("validateTicket (§19)", () => {
  const constraints: TicketConstraints = { maxAccumulatorLegs: 10 };

  it("passes a well-formed single-leg ticket backed by a real BET decision", () => {
    const assessment = betAssessment();
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(assessment)], createdBy: "agent-1", now: () => NOW });
    const result = validateTicket(ticket, constraints, [assessment]);
    expect(result.valid).toBe(true);
  });

  it("rejects a ticket whose leg has no corresponding BET decision — adversarial test #9 (invalid probability lineage)", () => {
    const assessment = betAssessment({ decision: DecisionOutcome.NO_EDGE, qualifies: false });
    const ticket = createTicketDraft({ legs: [ticketLegFromValueAssessment(assessment)], createdBy: "agent-1", now: () => NOW });
    const result = validateTicket(ticket, constraints, [assessment]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failures).toContain(TicketValidationFailureCode.DECISION_NOT_BET);
  });

  it("rejects a ticket with a leg flagged by leakage detection", () => {
    const assessment = betAssessment();
    const leg = ticketLegFromValueAssessment(assessment, /* leakageFlag */ true);
    const ticket = createTicketDraft({ legs: [leg], createdBy: "agent-1", now: () => NOW });
    const result = validateTicket(ticket, constraints, [assessment]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failures).toContain(TicketValidationFailureCode.LEAKAGE_FLAGGED);
  });

  it("rejects a ticket with a duplicate leg (identical fixture/market/selection/line)", () => {
    const assessment = betAssessment();
    const leg = ticketLegFromValueAssessment(assessment);
    const ticket = createTicketDraft({ legs: [leg, leg], createdBy: "agent-1", now: () => NOW });
    const result = validateTicket(ticket, constraints, [assessment]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failures).toContain(TicketValidationFailureCode.DUPLICATE_LEG);
  });

  it("rejects an accumulator exceeding the configured max leg count", () => {
    const assessments = Array.from({ length: 3 }, (_, i) => betAssessment({ eventId: `fixture-${i}` }));
    const legs = assessments.map((a) => ticketLegFromValueAssessment(a));
    const ticket = createTicketDraft({ legs, createdBy: "agent-1", now: () => NOW });
    const result = validateTicket(ticket, { maxAccumulatorLegs: 2 }, assessments);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failures).toContain(TicketValidationFailureCode.TOO_MANY_LEGS);
  });
});
