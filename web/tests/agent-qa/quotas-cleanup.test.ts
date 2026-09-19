import { describe, expect, it, vi } from "vitest";
import {
  AGENT_QA_WRITE_QUOTAS,
  createQuotaTracker,
  recordWrite,
} from "../../../scripts/agent-qa/quotas.mjs";
import {
  buildCleanupPlan,
  executeCleanupPlan,
  isAgentQaSweepCandidate,
  planUserSweep,
} from "../../../scripts/agent-qa/cleanup.mjs";
import { AGENT_QA_REGULAR_EMAIL } from "../../../scripts/agent-qa/personas.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("recordWrite", () => {
  it("counts writes up to the per-kind cap, then aborts the run", () => {
    const tracker = createQuotaTracker();
    expect(recordWrite(tracker, "cafe")).toBe(1);
    expect(recordWrite(tracker, "cafe")).toBe(2);
    expect(recordWrite(tracker, "cafe")).toBe(AGENT_QA_WRITE_QUOTAS.cafe);
    expect(() => recordWrite(tracker, "cafe")).toThrow(/quota exceeded/);
  });

  it("tracks each kind independently", () => {
    const tracker = createQuotaTracker();
    for (let i = 0; i < AGENT_QA_WRITE_QUOTAS.checkin; i += 1) recordWrite(tracker, "checkin");
    expect(() => recordWrite(tracker, "checkin")).toThrow(/quota exceeded/);
    expect(recordWrite(tracker, "image")).toBe(1);
  });

  it("rejects unknown entity kinds", () => {
    expect(() => recordWrite(createQuotaTracker(), "user")).toThrow(/unknown entity kind/);
  });
});

describe("isAgentQaSweepCandidate", () => {
  it("matches only stale fresh-persona users", () => {
    expect(isAgentQaSweepCandidate("agent-qa-fresh-old@coffeemode.test", NOW - 8 * DAY_MS, NOW, 7)).toBe(
      true,
    );
    expect(isAgentQaSweepCandidate("agent-qa-fresh-new@coffeemode.test", NOW - DAY_MS, NOW, 7)).toBe(
      false,
    );
  });

  it("never matches the persistent regular persona, however old", () => {
    expect(isAgentQaSweepCandidate(AGENT_QA_REGULAR_EMAIL, NOW - 365 * DAY_MS, NOW, 7)).toBe(false);
  });

  it("never matches journey users, foreign addresses, or bad timestamps", () => {
    expect(isAgentQaSweepCandidate("staging-journey+x@coffeemode.test", NOW - 30 * DAY_MS, NOW, 7)).toBe(
      false,
    );
    expect(isAgentQaSweepCandidate("agent-qa-fresh-x@example.com", NOW - 30 * DAY_MS, NOW, 7)).toBe(
      false,
    );
    expect(isAgentQaSweepCandidate("agent-qa-fresh-x@coffeemode.test", Number.NaN, NOW, 7)).toBe(false);
  });
});

describe("planUserSweep", () => {
  it("splits stale fresh users from everything deliberately kept", () => {
    const { remove, keep } = planUserSweep(
      [
        { email: "agent-qa-fresh-old@coffeemode.test", createdAtMs: NOW - 8 * DAY_MS },
        { email: AGENT_QA_REGULAR_EMAIL, createdAtMs: NOW - 365 * DAY_MS },
        { email: "agent-qa-fresh-new@coffeemode.test", createdAtMs: NOW - DAY_MS },
      ],
      { nowMs: NOW, maxAgeDays: 7 },
    );
    expect(remove.map((user: { email: string }) => user.email)).toEqual(["agent-qa-fresh-old@coffeemode.test"]);
    expect(keep.map((user: { email: string }) => user.email)).toEqual([
      AGENT_QA_REGULAR_EMAIL,
      "agent-qa-fresh-new@coffeemode.test",
    ]);
  });
});

describe("buildCleanupPlan / executeCleanupPlan", () => {
  it("plans app-API deletes for cafes and checkins, skips images with a reason", () => {
    const plan = buildCleanupPlan([
      { runId: "r", kind: "cafe", id: "cafe-1", createdAt: new Date(NOW).toISOString() },
      { runId: "r", kind: "image", id: "img-1", createdAt: new Date(NOW).toISOString() },
    ]);
    expect(plan[0]).toMatchObject({ action: "delete", method: "DELETE", path: "/api/cafes/cafe-1" });
    expect(plan[1].action).toBe("skip");
    if (plan[1].action === "skip") expect(plan[1].reason).toMatch(/no app delete endpoint/);
  });

  it("executes deletes through the allowlisted app base and records item failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("gone-missing", { status: 500 }));
    const plan = buildCleanupPlan([
      { runId: "r", kind: "cafe", id: "cafe-1", createdAt: new Date(NOW).toISOString() },
      { runId: "r", kind: "checkin", id: "checkin-1", createdAt: new Date(NOW).toISOString() },
    ]);
    const results = await executeCleanupPlan(plan, {
      appBaseUrl: "https://staging.cafemood.app",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(results[0]).toMatchObject({ ok: true, status: 200 });
    expect(results[1].ok).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://staging.cafemood.app/api/cafes/cafe-1");
    expect(init.method).toBe("DELETE");
  });

  it("refuses to execute a plan whose target leaves staging", async () => {
    const fetchImpl = vi.fn();
    const offAllowlist = buildCleanupPlan([
      { runId: "r", kind: "cafe", id: "x", createdAt: new Date(NOW).toISOString() },
    ]);
    await expect(
      executeCleanupPlan(offAllowlist, {
        appBaseUrl: "https://cafemood.app",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/outside the staging allowlist/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
