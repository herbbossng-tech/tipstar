// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState.js";

describe("EmptyState", () => {
  it("renders the exact factual title/message it is given — never sample/fake data", () => {
    render(<EmptyState title="No tickets yet" message="Tickets will appear here once they're proposed." />);
    expect(screen.getByText("No tickets yet")).toBeInTheDocument();
    expect(screen.getByText("Tickets will appear here once they're proposed.")).toBeInTheDocument();
  });
});
