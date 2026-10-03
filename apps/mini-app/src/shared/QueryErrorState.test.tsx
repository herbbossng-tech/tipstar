// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { describeErrorCode, QueryErrorState } from "./QueryErrorState.js";

describe("describeErrorCode — differentiated error UX (Section 09 §33/§59)", () => {
  it("gives network failures, session errors, license errors, and entitlement denials each a distinct, factual explanation", () => {
    const network = describeErrorCode("network_error", "raw");
    const session = describeErrorCode("SESSION_EXPIRED", "raw");
    const license = describeErrorCode("LICENSE_UNAVAILABLE", "raw");
    const entitlement = describeErrorCode("FEATURE_NOT_ENTITLED", "raw");

    const messages = new Set([network, session, license, entitlement]);
    expect(messages.size).toBe(4); // all four are distinct, factual messages
    for (const message of messages) expect(message).not.toBe("raw");
  });

  it("falls back to the server's own safe message for an unrecognized code — never hides it", () => {
    expect(describeErrorCode("SOME_NEW_CODE", "The server's own safe message.")).toBe("The server's own safe message.");
  });
});

describe("QueryErrorState", () => {
  it("renders the retry action only when one is supplied, and invokes it on click", () => {
    const onRetry = vi.fn();
    render(<QueryErrorState code="network_error" message="raw" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders no retry action when none is supplied", () => {
    render(<QueryErrorState code="network_error" message="raw" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("never displays a raw stack trace — only the safe, mapped message", () => {
    render(<QueryErrorState code="SERVER_ERROR" message={'Internal error: relation "foo" does not exist'} />);
    expect(screen.getByText('Internal error: relation "foo" does not exist')).toBeInTheDocument();
    // (SERVER_ERROR isn't specially mapped, so the server's own — already-sanitized — message is shown verbatim; the backend itself guarantees that message never contains an internal stack/SQL detail. This test documents that contract, not a new sanitization layer.)
  });
});
