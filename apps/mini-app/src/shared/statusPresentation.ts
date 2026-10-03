/**
 * Pure status -> {label, tone} mappings (Section 09 §41 — "status should
 * use icon + text, not color alone"; §65 — factual language, never
 * "guaranteed"/"sure win"/"lock"). Every backend enum this Mini App
 * displays has exactly one entry here — never a default/catch-all that
 * could silently mislabel an unrecognized future value as something
 * reassuring. Kept dependency-free (no JSX) so it is directly unit-
 * testable without a DOM.
 */

export type StatusTone = "success" | "danger" | "warning" | "neutral" | "info";

export interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
}

const TONE_GLYPH: Record<StatusTone, string> = { success: "✓", danger: "✕", warning: "!", neutral: "•", info: "i" };

export function glyphForTone(tone: StatusTone): string {
  return TONE_GLYPH[tone];
}

export function describeExecutionStatus(status: string): StatusPresentation {
  switch (status) {
    case "NOT_EXECUTED":
      return { label: "Not executed", tone: "neutral" };
    case "REQUESTED":
      return { label: "Requested", tone: "info" };
    case "AUTHORIZED":
      return { label: "Authorized", tone: "info" };
    case "SUBMITTED":
      return { label: "Submitted", tone: "info" };
    case "ACCEPTED":
      return { label: "Accepted", tone: "success" };
    case "EXECUTED":
      return { label: "Executed", tone: "success" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "UNKNOWN":
      return { label: "Status unknown", tone: "warning" };
    case "NOT_AVAILABLE":
      return { label: "Execution unavailable", tone: "warning" };
    case "MANUAL_REQUIRED":
      return { label: "Manual action required", tone: "warning" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function describeSettlementStatus(status: string): StatusPresentation {
  switch (status) {
    case "NOT_SETTLED":
      return { label: "Not settled", tone: "neutral" };
    case "PENDING":
      return { label: "Pending settlement", tone: "info" };
    case "WON":
      return { label: "Won", tone: "success" };
    case "LOST":
      return { label: "Lost", tone: "danger" };
    case "VOID":
      return { label: "Void", tone: "neutral" };
    case "PUSH":
      return { label: "Push", tone: "neutral" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function describeTicketStatus(status: string): StatusPresentation {
  switch (status) {
    case "DRAFT":
      return { label: "Draft", tone: "neutral" };
    case "PROPOSED":
      return { label: "Proposed", tone: "info" };
    case "VALIDATED":
      return { label: "Validated", tone: "info" };
    case "AUTHORIZED":
      return { label: "Authorized", tone: "info" };
    case "EXECUTING":
      return { label: "Executing", tone: "info" };
    case "EXECUTED":
      return { label: "Executed", tone: "success" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function describeDecisionOutcome(outcome: string): StatusPresentation {
  switch (outcome) {
    case "BET":
      return { label: "Decision: Bet", tone: "success" };
    case "NO_EDGE":
      return { label: "Decision: No edge", tone: "neutral" };
    case "WAIT":
      return { label: "Decision: Wait", tone: "neutral" };
    case "NO_TRADE":
      return { label: "Decision: No trade", tone: "neutral" };
    case "INSUFFICIENT_DATA":
      return { label: "Decision: Insufficient data", tone: "warning" };
    case "MARKET_UNSUPPORTED":
      return { label: "Decision: Market unsupported", tone: "neutral" };
    case "RISK_REJECTED":
      return { label: "Decision: Risk rejected", tone: "danger" };
    default:
      return { label: outcome, tone: "neutral" };
  }
}

export function describeRiskApproval(approved: boolean): StatusPresentation {
  return approved ? { label: "Risk approved", tone: "success" } : { label: "Risk rejected", tone: "danger" };
}

export function describeMatchStatus(status: string): StatusPresentation {
  switch (status) {
    case "scheduled":
    case "timed":
      return { label: "Scheduled", tone: "neutral" };
    case "live":
      return { label: "Live", tone: "info" };
    case "halftime":
      return { label: "Half-time", tone: "info" };
    case "finished":
      return { label: "Finished", tone: "success" };
    case "postponed":
      return { label: "Postponed", tone: "warning" };
    case "cancelled":
      return { label: "Cancelled", tone: "danger" };
    case "abandoned":
      return { label: "Abandoned", tone: "danger" };
    case "suspended":
      return { label: "Suspended", tone: "warning" };
    default:
      return { label: "Status unknown", tone: "neutral" };
  }
}

/** Section 11's job state machine (QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED) — distinct from `describeTicketStatus`/`describeExecutionStatus`, a different enum entirely. */
export function describeJobStatus(status: string): StatusPresentation {
  switch (status) {
    case "QUEUED":
      return { label: "Queued", tone: "neutral" };
    case "RUNNING":
      return { label: "Running", tone: "info" };
    case "SUCCEEDED":
      return { label: "Succeeded", tone: "success" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function describeLicenseStatus(status: string): StatusPresentation {
  switch (status) {
    case "trial":
      return { label: "Trial", tone: "info" };
    case "active":
      return { label: "Active", tone: "success" };
    case "suspended":
      return { label: "Suspended", tone: "warning" };
    case "expired":
      return { label: "Expired", tone: "danger" };
    case "revoked":
      return { label: "Revoked", tone: "danger" };
    default:
      return { label: status, tone: "neutral" };
  }
}
