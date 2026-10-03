// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UserProfile } from "../auth/types.js";
import { LicenseCard } from "./LicenseCard.js";

function license(status: NonNullable<UserProfile["license"]>["status"]): NonNullable<UserProfile["license"]> {
  return { plan: "Pro", status, startsAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-31T00:00:00Z", isActive: status === "trial" || status === "active" };
}

describe("LicenseCard — every real license state (Section 09 §10)", () => {
  it("shows an honest empty state for no license — never a fabricated trial", () => {
    render(<LicenseCard license={null} />);
    expect(screen.getByText("No active license")).toBeInTheDocument();
  });

  it.each(["trial", "active", "suspended", "expired", "revoked"] as const)("renders the %s state with its own distinct label", (status) => {
    render(<LicenseCard license={license(status)} />);
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.queryByText("No active license")).not.toBeInTheDocument();
  });
});
