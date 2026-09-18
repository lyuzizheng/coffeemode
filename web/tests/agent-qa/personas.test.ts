import { describe, expect, it } from "vitest";
import {
  AGENT_QA_REGULAR_EMAIL,
  buildFreshEmail,
  isAgentQaEmail,
  isProtectedPersona,
  parseAgentQaEmail,
} from "../../../scripts/agent-qa/personas.mjs";

describe("buildFreshEmail", () => {
  it("builds a per-run fresh persona address", () => {
    expect(buildFreshEmail("run123")).toBe("agent-qa-fresh-run123@coffeemode.test");
  });

  it("rejects a run id that could widen the sweep pattern", () => {
    expect(() => buildFreshEmail("")).toThrow(/run id/);
    expect(() => buildFreshEmail("a@b")).toThrow(/run id/);
    expect(() => buildFreshEmail("a b")).toThrow(/run id/);
  });
});

describe("parseAgentQaEmail", () => {
  it("classifies the fresh and regular personas", () => {
    expect(parseAgentQaEmail("agent-qa-fresh-abc@coffeemode.test")).toEqual({
      persona: "fresh",
      runId: "abc",
    });
    expect(parseAgentQaEmail(AGENT_QA_REGULAR_EMAIL)).toEqual({ persona: "regular", runId: null });
  });

  it("returns null for journey users, foreign domains, and malformed addresses", () => {
    expect(parseAgentQaEmail("staging-journey+abc@coffeemode.test")).toBeNull();
    expect(parseAgentQaEmail("agent-qa-fresh-abc@example.com")).toBeNull();
    expect(parseAgentQaEmail("agent-qa-regular@example.com")).toBeNull();
    expect(parseAgentQaEmail("not-an-email")).toBeNull();
    expect(parseAgentQaEmail(null)).toBeNull();
  });
});

describe("persona guards", () => {
  it("never classifies a journey address as agent-QA", () => {
    expect(isAgentQaEmail("staging-journey+abc@coffeemode.test")).toBe(false);
    expect(isAgentQaEmail("agent-qa-fresh-abc@coffeemode.test")).toBe(true);
  });

  it("protects only the persistent regular persona", () => {
    expect(isProtectedPersona(AGENT_QA_REGULAR_EMAIL)).toBe(true);
    expect(isProtectedPersona("agent-qa-fresh-abc@coffeemode.test")).toBe(false);
    expect(isProtectedPersona("someone@example.com")).toBe(false);
  });
});
