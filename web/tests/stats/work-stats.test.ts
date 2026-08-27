import { describe, expect, it } from "vitest";
import { coerceWorkStats, emptyWorkStats, computeCafeStats } from "@/lib/stats/work-stats";

describe("coerceWorkStats preserves persisted scores (issue #146)", () => {
  it("round-trips experience_score and composite_score", () => {
    const stats = computeCafeStats([
      {
        id: "chk-1",
        cafe_id: "cafe-1",
        user_id: "u1",
        is_creation: true,
        scores: { wifi: 70, outlets: 60, seats: 50, temp: 40, coffee: 90, overall: 80 },
        max_stay: null,
        note: null,
        photos: [],
        likes_count: 0,
        visited_at: "2026-08-01T10:00:00Z",
        created_at: "2026-08-01T10:00:00Z",
        updated_at: "2026-08-01T10:00:00Z",
        deleted_at: null,
      },
    ]);
    // Simulate JSON round-trip through Postgres jsonb.
    const raw = JSON.parse(JSON.stringify(stats));
    const coerced = coerceWorkStats(raw);
    expect(coerced.experience_score).toBe(stats.experience_score);
    expect(coerced.composite_score).toBe(stats.composite_score);
    expect(coerced.updated_at).toBe(stats.updated_at);
    expect(coerced.n_users).toBe(1);
    expect(coerced.n_checkins).toBe(1);
  });

  it("preserves explicitly persisted null scores (no dims)", () => {
    const raw = { n_users: 0, n_checkins: 0, experience_score: null, composite_score: null };
    const coerced = coerceWorkStats(raw);
    expect(coerced.experience_score).toBeNull();
    expect(coerced.composite_score).toBeNull();
  });

  it("derives scores from dims when scores are missing (legacy '{}' rows)", () => {
    const raw = {
      n_users: 1,
      n_checkins: 1,
      dims: {
        wifi: { sum: 70, n: 1 },
        overall: { sum: 80, n: 1 },
      },
    };
    const coerced = coerceWorkStats(raw);
    expect(coerced.experience_score).toBe(80);
    expect(coerced.composite_score).not.toBeNull();
  });

  it("preserves updated_at when valid, falls back otherwise", () => {
    const iso = "2026-08-02T10:00:00Z";
    expect(coerceWorkStats({ updated_at: iso }).updated_at).toBe(iso);
    // invalid timestamp keeps the fresh empty timestamp (is a valid ISO)
    const fallback = coerceWorkStats({ updated_at: "not-a-date" }).updated_at;
    expect(() => new Date(fallback).toISOString()).not.toThrow();
    expect(new Date(fallback).getTime()).not.toBeNaN();
  });

  it("does not lose dims or policies on round-trip", () => {
    const raw = emptyWorkStats();
    raw.policies.max_stay = { unlimited: 2 };
    raw.dims.wifi = { sum: 123, n: 2 };
    (raw as unknown as Record<string, unknown>).experience_score = 77;
    (raw as unknown as Record<string, unknown>).composite_score = 66.5;
    const coerced = coerceWorkStats(JSON.parse(JSON.stringify(raw)));
    expect(coerced.policies.max_stay.unlimited).toBe(2);
    expect(coerced.dims.wifi).toEqual({ sum: 123, n: 2 });
    expect(coerced.experience_score).toBe(77);
    expect(coerced.composite_score).toBe(66.5);
  });

  it("calculates dimMean and getDimensionAverage accurately", async () => {
    const { dimMean, getDimensionAverage } = await import("@/lib/stats/work-stats");
    const raw = emptyWorkStats();
    raw.dims.wifi = { sum: 170, n: 2 };
    expect(getDimensionAverage(raw, "wifi")).toBe(85);
    expect(dimMean(raw, "wifi")).toBe(85);

    raw.dims.wifi = { sum: 175, n: 2 };
    expect(getDimensionAverage(raw, "wifi")).toBe(87.5);
    expect(dimMean(raw, "wifi")).toBe(88);

    expect(getDimensionAverage(raw, "seats")).toBeNull();
    expect(dimMean(raw, "seats")).toBeNull();
  });

  it("computes consensus options and policy answers", async () => {
    const { getConsensusOption, policyConsensus } = await import("@/lib/stats/work-stats");
    expect(getConsensusOption(undefined)).toBeNull();
    expect(getConsensusOption({})).toBeNull();
    expect(getConsensusOption({ "2h": 3, unlimited: 5, "1h": 1 })).toBe("unlimited");

    const raw = emptyWorkStats();
    raw.policies.max_stay = { "2h": 4, unlimited: 2 };
    expect(policyConsensus(raw, "max_stay")).toBe("2h");
  });

  it("isUserPresent detects contributions with dimension ratings or stay policies without overall", async () => {
    const { isUserPresent } = await import("@/lib/stats/work-stats");
    expect(isUserPresent(null)).toBe(false);
    expect(
      isUserPresent({
        dims: {
          wifi: undefined,
          outlets: undefined,
          seats: undefined,
          temp: undefined,
          coffee: undefined,
          overall: undefined,
        },
      }),
    ).toBe(false);

    expect(
      isUserPresent({
        dims: {
          wifi: 90,
          outlets: undefined,
          seats: undefined,
          temp: undefined,
          coffee: undefined,
          overall: undefined,
        },
      }),
    ).toBe(true);

    expect(
      isUserPresent({
        dims: {
          wifi: undefined,
          outlets: undefined,
          seats: undefined,
          temp: undefined,
          coffee: undefined,
          overall: undefined,
        },
        max_stay: "2h",
      }),
    ).toBe(true);
  });
});
