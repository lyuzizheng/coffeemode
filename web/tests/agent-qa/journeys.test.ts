import { describe, expect, it } from "vitest";
import {
  AGENT_QA_JOURNEYS,
  getJourney,
  planRound,
  quotaKeysFor,
} from "../../../scripts/agent-qa/journeys.mjs";
import { AGENT_QA_WRITE_QUOTAS } from "../../../scripts/agent-qa/quotas.mjs";

describe("AGENT_QA_JOURNEYS", () => {
  it("covers P0 → P1 → P2 → P3 with no interactive-OAuth journey", () => {
    const ids = AGENT_QA_JOURNEYS.map((journey) => journey.id);
    expect(ids).toEqual([
      "p0-anonymous-discovery",
      "p1-login-checkin",
      "p1-profile",
      "p2-search",
      "p2-create-cafe",
      "p2-photo-upload",
      "p3-maps-link-import",
      "p3-social-like",
      "p3-lifecycle-delete-cafe",
    ]);
  });

  it("uses unique ids in rollout order and declares verdicts up front", () => {
    const seen = new Set<string>();
    for (const journey of AGENT_QA_JOURNEYS) {
      expect(seen.has(journey.id)).toBe(false);
      seen.add(journey.id);
      expect(journey.summary.length).toBeGreaterThan(0);
      expect(journey.steps.length).toBeGreaterThan(0);
      expect(journey.verdict.deterministic.length).toBeGreaterThan(0);
      expect(journey.verdict.semantic.length).toBeGreaterThan(0);
      expect(journey.preconditions.length).toBeGreaterThan(0);
    }
  });

  it("keeps every write family inside the scaffold quota keys", () => {
    for (const journey of AGENT_QA_JOURNEYS) {
      for (const key of quotaKeysFor(journey.writes)) {
        expect(Object.keys(AGENT_QA_WRITE_QUOTAS)).toContain(key);
      }
    }
  });

  it("never parks a journey on interactive OAuth — spec 0010 keeps those manual", () => {
    const text = JSON.stringify(AGENT_QA_JOURNEYS).toLowerCase();
    expect(text).not.toContain("oauth");
  });
});

describe("planRound", () => {
  it("runs P0 + P2-search on the Access token alone", () => {
    const { runnable } = planRound(["access-token"]);
    expect(runnable.map((journey) => journey.id)).toEqual([
      "p0-anonymous-discovery",
      "p2-search",
    ]);
  });

  it("unlocks P1 login/check-in/profile once the Supabase triple resolves", () => {
    const { runnable, blocked } = planRound(["access-token", "supabase-keys"]);
    expect(runnable.map((journey) => journey.id)).toContain("p1-login-checkin");
    expect(runnable.map((journey) => journey.id)).toContain("p1-profile");
    expect(blocked.every((entry) => entry.missing.length > 0)).toBe(true);
  });

  it("names the missing precondition instead of running blocked", () => {
    const { blocked } = planRound(["access-token"]);
    const login = blocked.find((entry) => entry.journey.id === "p1-login-checkin");
    expect(login?.missing).toEqual(["supabase-keys"]);
    const social = blocked.find((entry) => entry.journey.id === "p3-social-like");
    expect(social?.missing).toContain("second-persona");
  });
});

describe("getJourney", () => {
  it("resolves a stable id for dedup keys", () => {
    expect(getJourney("p1-login-checkin")?.priority).toBe("P1");
  });

  it("returns undefined for unknown ids instead of throwing", () => {
    expect(getJourney("does-not-exist")).toBeUndefined();
  });
});

describe("quotaKeysFor", () => {
  it("maps the fused create-cafe journey to one cafe plus one checkin", () => {
    expect(quotaKeysFor("cafe+checkin")).toEqual(["cafe", "checkin"]);
  });

  it("maps read-only and non-quota writes to no keys", () => {
    expect(quotaKeysFor("read")).toEqual([]);
    expect(quotaKeysFor("like")).toEqual([]);
    expect(quotaKeysFor("profile")).toEqual([]);
  });
});
