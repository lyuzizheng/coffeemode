import { describe, expect, it } from "vitest";
import {
  applyUserContributionDiff,
  emptyWorkStats,
  WORK_DIMS,
  type DimWeights,
} from "@/lib/stats/work-stats";

// Canonical weights from web/config/app.yaml (stats.dimWeights).
const WEIGHTS: DimWeights = { wifi: 0.3, outlets: 0.2, seats: 0.2, temp: 0.15, coffee: 0.15 };

function contribution(
  dims: Partial<Record<(typeof WORK_DIMS)[number], number>>,
  maxStay?: string,
) {
  return {
    dims: Object.fromEntries(WORK_DIMS.map((d) => [d, dims[d]])) as Record<
      (typeof WORK_DIMS)[number],
      number | undefined
    >,
    max_stay: maxStay,
  };
}

describe("applyUserContributionDiff — anomalous sequences never go negative (BRAWUKA-692)", () => {
  it("duplicate delete on an empty snapshot clamps dims and n_users at zero", () => {
    const ghost = contribution({ wifi: 80, overall: 70 }, "2h");
    const next = applyUserContributionDiff(emptyWorkStats(), ghost, null, 0, WEIGHTS);
    for (const dim of WORK_DIMS) {
      expect(next.dims[dim].n).toBeGreaterThanOrEqual(0);
      expect(next.dims[dim].sum).toBeGreaterThanOrEqual(0);
    }
    expect(next.n_users).toBe(0);
    expect(next.experience_score).toBeNull();
  });

  it("add then double delete resets to zero without residue", () => {
    const c = contribution({ wifi: 60, overall: 60 });
    let stats = applyUserContributionDiff(emptyWorkStats(), null, c, 1, WEIGHTS);
    stats = applyUserContributionDiff(stats, c, null, 0, WEIGHTS);
    stats = applyUserContributionDiff(stats, c, null, 0, WEIGHTS);
    expect(stats.dims.wifi).toEqual({ sum: 0, n: 0 });
    expect(stats.dims.overall).toEqual({ sum: 0, n: 0 });
    expect(stats.n_users).toBe(0);
  });

  it("stale before-image larger than the residue resets the dim instead of going negative", () => {
    const small = contribution({ wifi: 30 });
    const stale = contribution({ wifi: 90 });
    let stats = applyUserContributionDiff(emptyWorkStats(), null, small, 1, WEIGHTS);
    stats = applyUserContributionDiff(stats, stale, null, 1, WEIGHTS);
    stats = applyUserContributionDiff(stats, stale, null, 1, WEIGHTS);
    expect(stats.dims.wifi).toEqual({ sum: 0, n: 0 });
  });

  it("normal add/delete path is unaffected by the clamp", () => {
    const a = contribution({ wifi: 80, outlets: 70, overall: 75 }, "2h");
    const b = contribution({ wifi: 90, outlets: 70, overall: 85 }, "4h");
    let stats = applyUserContributionDiff(emptyWorkStats(), null, a, 1, WEIGHTS);
    stats = applyUserContributionDiff(stats, null, b, 2, WEIGHTS);
    expect(stats.dims.wifi).toEqual({ sum: 170, n: 2 });
    expect(stats.experience_score).toBe(80);
    expect(stats.n_users).toBe(2);
    stats = applyUserContributionDiff(stats, b, null, 1, WEIGHTS);
    expect(stats.dims.wifi).toEqual({ sum: 80, n: 1 });
    expect(stats.n_users).toBe(1);
  });
});
