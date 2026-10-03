import { describe, expect, it } from "vitest";
import { describeDecisionOutcome, describeExecutionStatus, describeLicenseStatus, describeMatchStatus, describeRiskApproval, describeSettlementStatus, describeTicketStatus, glyphForTone } from "./statusPresentation.js";

describe("statusPresentation", () => {
  it("maps every real ExecutionResultStatus value plus the two Mini-App-only states, never a generic fallback for a known value", () => {
    const known = ["NOT_EXECUTED", "REQUESTED", "AUTHORIZED", "SUBMITTED", "ACCEPTED", "EXECUTED", "REJECTED", "FAILED", "UNKNOWN", "NOT_AVAILABLE", "MANUAL_REQUIRED"];
    for (const status of known) {
      const result = describeExecutionStatus(status);
      expect(result.label).not.toBe(status); // every known value gets a real, human label
    }
  });

  it("falls back to the raw value (never hides an unrecognized status) for execution status", () => {
    expect(describeExecutionStatus("SOMETHING_NEW").label).toBe("SOMETHING_NEW");
  });

  it("labels NOT_SETTLED distinctly from the real PENDING settlement state", () => {
    expect(describeSettlementStatus("NOT_SETTLED").label).not.toBe(describeSettlementStatus("PENDING").label);
    expect(describeSettlementStatus("NOT_SETTLED").tone).toBe("neutral");
    expect(describeSettlementStatus("PENDING").tone).toBe("info");
  });

  it("gives WON a success tone and LOST a danger tone — never the reverse", () => {
    expect(describeSettlementStatus("WON").tone).toBe("success");
    expect(describeSettlementStatus("LOST").tone).toBe("danger");
  });

  it("never labels RISK_REJECTED with a success tone", () => {
    expect(describeDecisionOutcome("RISK_REJECTED").tone).toBe("danger");
  });

  it("derives risk approval presentation purely from the boolean — no hidden third state", () => {
    expect(describeRiskApproval(true).tone).toBe("success");
    expect(describeRiskApproval(false).tone).toBe("danger");
  });

  it("maps every real TicketStatus value", () => {
    for (const status of ["DRAFT", "PROPOSED", "VALIDATED", "AUTHORIZED", "EXECUTING", "EXECUTED", "REJECTED", "CANCELLED"]) {
      expect(describeTicketStatus(status).label).not.toBe(status);
    }
  });

  it("maps every real match_status value", () => {
    for (const status of ["scheduled", "timed", "live", "halftime", "finished", "postponed", "cancelled", "abandoned", "suspended"]) {
      expect(describeMatchStatus(status).label).not.toBe("Status unknown");
    }
    expect(describeMatchStatus("totally_unknown").label).toBe("Status unknown");
  });

  it("maps every real license_status value", () => {
    for (const status of ["trial", "active", "suspended", "expired", "revoked"]) {
      expect(describeLicenseStatus(status).label).not.toBe(status);
    }
  });

  it("gives every tone a distinct glyph (icon + text, never color alone — §41)", () => {
    const tones = ["success", "danger", "warning", "neutral", "info"] as const;
    const glyphs = new Set(tones.map((tone) => glyphForTone(tone)));
    expect(glyphs.size).toBe(tones.length);
  });
});
