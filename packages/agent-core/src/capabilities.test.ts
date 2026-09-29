import { describe, expect, it } from "vitest";
import { isWithinDeclaredSideEffectLevel, SideEffectLevel, type AgentDeclaration } from "./capabilities.js";

function declaration(sideEffectLevel: AgentDeclaration["sideEffectLevel"]): AgentDeclaration {
  return {
    agentId: "agent-1",
    agentType: "football_intelligence",
    version: "0.1.0",
    capabilities: [],
    requiredEntitlements: [],
    allowedInputs: [],
    allowedOutputs: [],
    dependencies: [],
    sideEffectLevel,
  };
}

describe("capabilities.ts — side-effect level escalation", () => {
  it("allows a level at or below the declared ceiling", () => {
    const decl = declaration(SideEffectLevel.PROPOSAL);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.READ_ONLY)).toBe(true);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.ANALYSIS)).toBe(true);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.PROPOSAL)).toBe(true);
  });

  it("rejects a level above the declared ceiling — an agent may not silently escalate", () => {
    const decl = declaration(SideEffectLevel.ANALYSIS);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.PROPOSAL)).toBe(false);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.REQUESTED_ACTION)).toBe(false);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.EXECUTION)).toBe(false);
  });

  it("a READ_ONLY-declared agent cannot claim EXECUTION", () => {
    const decl = declaration(SideEffectLevel.READ_ONLY);
    expect(isWithinDeclaredSideEffectLevel(decl, SideEffectLevel.EXECUTION)).toBe(false);
  });

  it("an EXECUTION-declared agent may still operate at any lower level", () => {
    const decl = declaration(SideEffectLevel.EXECUTION);
    for (const level of Object.values(SideEffectLevel)) {
      expect(isWithinDeclaredSideEffectLevel(decl, level)).toBe(true);
    }
  });
});
