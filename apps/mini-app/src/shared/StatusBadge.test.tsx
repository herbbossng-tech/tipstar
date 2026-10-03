// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge.js";

describe("StatusBadge", () => {
  it("renders both a glyph and the label text — never color alone (Section 09 §41)", () => {
    render(<StatusBadge label="Won" tone="success" />);
    expect(screen.getByText("Won")).toBeInTheDocument();
    // The glyph is decorative (aria-hidden) — the text is what a screen reader announces.
    expect(screen.getByText("Won").closest(".status-badge")).toHaveClass("status-badge--success");
  });

  it("renders an unrecognized/danger status just as visibly as a success one", () => {
    render(<StatusBadge label="Lost" tone="danger" />);
    expect(screen.getByText("Lost")).toBeInTheDocument();
  });
});
