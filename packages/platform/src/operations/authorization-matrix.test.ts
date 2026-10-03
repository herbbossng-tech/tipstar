import { Role } from "../license.js";
import { UserStatus } from "../roles.js";
import { describe, expect, it } from "vitest";
import { AUTHORIZATION_MATRIX, canPerform, OperationalCapability } from "./authorization-matrix.js";

describe("canPerform — Section 11 §C authorization matrix (read-only, never the actual enforcement)", () => {
  const owner = { userId: "o1", role: Role.OWNER, status: UserStatus.ACTIVE };
  const admin = { userId: "a1", role: Role.ADMIN, status: UserStatus.ACTIVE };
  const user = { userId: "u1", role: Role.USER, status: UserStatus.ACTIVE };
  const suspendedAdmin = { userId: "a2", role: Role.ADMIN, status: UserStatus.SUSPENDED };

  it("TEST 1: a USER can perform no operational capability", () => {
    for (const capability of Object.values(OperationalCapability)) {
      expect(canPerform(user, capability)).toBe(false);
    }
  });

  it("TEST 2: an ADMIN can perform every capability ADMIN is granted", () => {
    for (const capability of AUTHORIZATION_MATRIX.ADMIN) {
      expect(canPerform(admin, capability)).toBe(true);
    }
  });

  it("TEST 3: an OWNER can perform every capability at all", () => {
    for (const capability of Object.values(OperationalCapability)) {
      expect(canPerform(owner, capability)).toBe(true);
    }
  });

  it("TEST 4: a SUSPENDED admin can perform nothing — an inactive account has no operational capability regardless of role", () => {
    for (const capability of Object.values(OperationalCapability)) {
      expect(canPerform(suspendedAdmin, capability)).toBe(false);
    }
  });

  it("TEST 5: the matrix never grants USER any capability", () => {
    expect(AUTHORIZATION_MATRIX.USER).toHaveLength(0);
  });
});
