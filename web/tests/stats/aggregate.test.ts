import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "pg";
import type { CheckIn } from "@/types/checkins";
import {
  COMPOSITE_DIMS,
  DIM_WEIGHTS,
  applyUserContributionDiff,
  computeCafeStats,
  computeUserContribution,
  emptyWorkStats,
  incrementalUpdateWorkStats,
  recomputeWorkStats,
} from "@/lib/stats/aggregate";

function makeCheckIn(overrides: Partial<CheckIn> & { visited_at: string }): CheckIn {
  const {
    visited_at,
    created_at,
    updated_at,
    scores,
    ...rest
  } = overrides;

  return {
    id: "00000000-0000-4000-8000-000000000000",
    cafe_id: "cafe-1",
    user_id: "user-1",
    is_creation: false,
    scores: scores ?? {},
    min_spend: null,
    max_stay: null,
    note: null,
    photos: [],
    likes_count: 0,
    visited_at,
    created_at: created_at ?? visited_at,
    updated_at: updated_at ?? visited_at,
    deleted_at: null,
    ...rest,
  };
}

const fullScores = {
  wifi: 70,
  outlets: 60,
  seats: 50,
  temp: 40,
  coffee: 90,
  overall: 80,
};

const repeatScores = {
  wifi: 80,
  outlets: 70,
  seats: 60,
  temp: 50,
  coffee: 95,
  overall: 90,
};

describe("computeCafeStats", () => {
  it("first check-in adds a user and updates dims", () => {
    const checkin = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      min_spend: "none",
      max_stay: "3h",
      visited_at: "2026-08-01T10:00:00Z",
    });

    const stats = computeCafeStats([checkin]);

    expect(stats.n_users).toBe(1);
    expect(stats.n_checkins).toBe(1);
    expect(stats.dims.overall).toEqual({ sum: 80, n: 1 });
    expect(stats.dims.wifi).toEqual({ sum: 70, n: 1 });
    expect(stats.experience_score).toBe(80);
    expect(stats.policies.min_spend.none).toBe(1);
    expect(stats.policies.max_stay["3h"]).toBe(1);

    const expectedComposite = COMPOSITE_DIMS.reduce(
      (sum, dim) => sum + fullScores[dim] * DIM_WEIGHTS[dim],
      0,
    );
    expect(stats.composite_score).toBeCloseTo(expectedComposite, 6);
  });

  it("repeat check-in recency weighting", () => {
    const first = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      min_spend: "none",
      max_stay: "3h",
      visited_at: "2026-08-01T10:00:00Z",
    });
    const second = makeCheckIn({
      id: "chk-2",
      scores: repeatScores,
      min_spend: "drink",
      max_stay: "unlimited",
      visited_at: "2026-08-02T10:00:00Z",
    });

    const stats = computeCafeStats([first, second]);

    expect(stats.n_users).toBe(1);
    expect(stats.n_checkins).toBe(2);

    // newest weight = 1, previous = 0.6
    const expectedOverall = (90 * 1 + 80 * 0.6) / (1 + 0.6);
    expect(stats.dims.overall.sum / stats.dims.overall.n).toBeCloseTo(
      expectedOverall,
      6,
    );

    expect(stats.policies.min_spend.drink).toBe(1);
    expect(stats.policies.max_stay.unlimited).toBe(1);
    expect(stats.policies.min_spend.none).toBeUndefined();
  });

  it("edit recomputes", () => {
    const first = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      visited_at: "2026-08-01T10:00:00Z",
    });
    const second = makeCheckIn({
      id: "chk-2",
      scores: repeatScores,
      visited_at: "2026-08-02T10:00:00Z",
    });

    const before = computeCafeStats([first, second]);

    const edited = { ...second, scores: { ...second.scores, overall: 50 } };
    const after = computeCafeStats([first, edited]);

    expect(after.dims.overall.sum / after.dims.overall.n).toBeCloseTo(
      (50 * 1 + 80 * 0.6) / 1.6,
      6,
    );
    expect(after.dims.overall.sum / after.dims.overall.n).not.toBeCloseTo(
      before.dims.overall.sum / before.dims.overall.n,
      6,
    );
  });

  it("soft-delete excludes the row", () => {
    const first = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      visited_at: "2026-08-01T10:00:00Z",
    });
    const deleted = makeCheckIn({
      id: "chk-2",
      scores: repeatScores,
      visited_at: "2026-08-02T10:00:00Z",
      deleted_at: "2026-08-03T10:00:00Z",
    });

    // computeCafeStats expects already-filtered non-deleted rows.
    const active = [first, deleted].filter((c) => c.deleted_at === null);
    const stats = computeCafeStats(active);
    expect(stats.n_checkins).toBe(1);
    expect(stats.dims.overall).toEqual({ sum: 80, n: 1 });
  });

  it("social_weight = 0 leaves likes out of scoring", () => {
    const newest = makeCheckIn({
      id: "chk-1",
      scores: { overall: 80 },
      likes_count: 10,
      visited_at: "2026-08-02T10:00:00Z",
    });
    const older = makeCheckIn({
      id: "chk-2",
      scores: { overall: 100 },
      likes_count: 0,
      visited_at: "2026-08-01T10:00:00Z",
    });

    const withLikesSw0 = computeUserContribution([newest, older], 0);
    const withoutLikes = computeUserContribution(
      [
        { ...newest, likes_count: 0 },
        { ...older, likes_count: 0 },
      ],
      0,
    );

    expect(withLikesSw0.dims.overall).toBeCloseTo(withoutLikes.dims.overall!, 6);
    expect(withLikesSw0.dims.overall).toBeCloseTo(
      (80 * 1 + 100 * 0.6) / 1.6,
      6,
    );

    const withSocial = computeUserContribution([newest, older], 0.5);
    expect(withSocial.dims.overall).not.toBeCloseTo(withLikesSw0.dims.overall!, 6);
  });

  it("normalizes composite score across available dimensions", () => {
    const checkin = makeCheckIn({
      id: "chk-1",
      scores: { overall: 80, wifi: 60, coffee: 90 },
      visited_at: "2026-08-01T10:00:00Z",
    });

    const stats = computeCafeStats([checkin]);
    const weighted = 60 * DIM_WEIGHTS.wifi + 90 * DIM_WEIGHTS.coffee;
    const weightSum = DIM_WEIGHTS.wifi + DIM_WEIGHTS.coffee;
    expect(stats.composite_score).toBeCloseTo(weighted / weightSum, 6);
  });
});

describe("applyUserContributionDiff", () => {
  it("adds a new user and removes a user correctly", () => {
    let stats = emptyWorkStats();
    const user = computeUserContribution([
      makeCheckIn({
        id: "chk-1",
        scores: fullScores,
        min_spend: "none",
        max_stay: "3h",
        visited_at: "2026-08-01T10:00:00Z",
      }),
    ]);

    stats = applyUserContributionDiff(stats, null, user, 1);
    expect(stats.n_users).toBe(1);
    expect(stats.dims.wifi.sum).toBe(70);

    stats = applyUserContributionDiff(stats, user, null, 0);
    expect(stats.n_users).toBe(0);
    expect(stats.dims.wifi.sum).toBe(0);
    expect(stats.dims.wifi.n).toBe(0);
    expect(stats.policies.min_spend.none).toBeUndefined();
  });
});

describe("incrementalUpdateWorkStats", () => {
  it("updates work_stats in a single UPDATE for a new check-in", async () => {
    const prior = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      min_spend: "none",
      max_stay: "3h",
      visited_at: "2026-08-01T10:00:00Z",
    });
    const changed = makeCheckIn({
      id: "chk-2",
      scores: repeatScores,
      min_spend: "drink",
      max_stay: "unlimited",
      visited_at: "2026-08-02T10:00:00Z",
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      // Order matters: the count query also contains "from checkins".
      if (sql.includes("count(*)")) {
        return { rows: [{ n: 1 }], rowCount: 1 } as unknown as QueryResult<{
          n: number;
        }>;
      }
      if (sql.includes("from checkins")) {
        return {
          rows: [prior],
          rowCount: 1,
        } as unknown as QueryResult<CheckIn>;
      }
      if (sql.includes("select work_stats")) {
        // The DB already reflects the prior check-in's contribution.
        const priorStats = computeCafeStats([prior]);
        return {
          rows: [{ work_stats: priorStats }],
          rowCount: 1,
        } as unknown as QueryResult<{ work_stats: unknown }>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
    }) as unknown as <T extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;

    await incrementalUpdateWorkStats("cafe-1", "user-1", query, changed);

    const updateCall = calls.find((c) => c.sql.includes("update cafes"));
    expect(updateCall).toBeDefined();
    const written = JSON.parse(updateCall!.params[0] as string) as ReturnType<
      typeof computeCafeStats
    >;
    expect(written.n_checkins).toBe(2);
    expect(written.n_users).toBe(1);
    expect(written.dims.overall.n).toBe(1);
  });

  it("treats the most recent check-in as changed when changedCheckIn is omitted", async () => {
    const latest = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      visited_at: "2026-08-02T10:00:00Z",
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes("count(*)")) {
        return { rows: [{ n: 1 }], rowCount: 1 } as unknown as QueryResult<{ n: number }>;
      }
      if (sql.includes("from checkins")) {
        return { rows: [latest], rowCount: 1 } as unknown as QueryResult<CheckIn>;
      }
      if (sql.includes("select work_stats")) {
        return { rows: [{ work_stats: emptyWorkStats() }], rowCount: 1 } as unknown as QueryResult<{
          work_stats: unknown;
        }>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
    }) as unknown as <T extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;

    await incrementalUpdateWorkStats("cafe-1", "user-1", query);

    const updateCall = calls.find((c) => c.sql.includes("update cafes"));
    expect(updateCall).toBeDefined();
    const written = JSON.parse(updateCall!.params[0] as string) as ReturnType<
      typeof computeCafeStats
    >;
    expect(written.n_checkins).toBe(1);
    expect(written.n_users).toBe(1);
    expect(written.dims.overall.n).toBe(1);
    expect(written.dims.overall.sum).toBe(fullScores.overall);
  });

  it("uses the supplied changedCheckIn values when editing an existing persisted row", async () => {
    const oldRow = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      min_spend: "none",
      max_stay: "3h",
      visited_at: "2026-08-01T10:00:00Z",
    });
    const editedRow = makeCheckIn({
      id: "chk-1",
      scores: repeatScores,
      min_spend: "drink",
      max_stay: "unlimited",
      visited_at: "2026-08-01T10:00:00Z",
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes("count(*)")) {
        return { rows: [{ n: 1 }], rowCount: 1 } as unknown as QueryResult<{ n: number }>;
      }
      if (sql.includes("from checkins")) {
        return { rows: [oldRow], rowCount: 1 } as unknown as QueryResult<CheckIn>;
      }
      if (sql.includes("select work_stats")) {
        return { rows: [{ work_stats: computeCafeStats([oldRow]) }], rowCount: 1 } as unknown as QueryResult<{
          work_stats: unknown;
        }>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
    }) as unknown as <T extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;

    await incrementalUpdateWorkStats("cafe-1", "user-1", query, editedRow);

    const updateCall = calls.find((c) => c.sql.includes("update cafes"));
    expect(updateCall).toBeDefined();
    const written = JSON.parse(updateCall!.params[0] as string) as ReturnType<
      typeof computeCafeStats
    >;
    expect(written.n_checkins).toBe(1);
    expect(written.n_users).toBe(1);
    expect(written.dims.overall.n).toBe(1);
    expect(written.dims.overall.sum).toBe(repeatScores.overall);
  });
});

describe("recomputeWorkStats", () => {
  it("recomputes from all non-deleted check-ins and writes the result", async () => {
    const first = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      visited_at: "2026-08-01T10:00:00Z",
    });
    const second = makeCheckIn({
      id: "chk-2",
      scores: repeatScores,
      min_spend: "drink",
      max_stay: "unlimited",
      visited_at: "2026-08-02T10:00:00Z",
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes("from checkins")) {
        return {
          rows: [first, second],
          rowCount: 2,
        } as unknown as QueryResult<CheckIn>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
    }) as unknown as <T extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;

    await recomputeWorkStats("cafe-1", query);

    const updateCall = calls.find((c) => c.sql.includes("update cafes"));
    expect(updateCall).toBeDefined();
    expect(updateCall!.params[1]).toBe("cafe-1");
    const written = JSON.parse(updateCall!.params[0] as string) as ReturnType<
      typeof computeCafeStats
    >;
    expect(written.n_checkins).toBe(2);
    expect(written.n_users).toBe(1);
    // soft-deleted rows are excluded by the SQL, and the recompute path
    // must not carry policy answers for rows it did not see.
    expect(written.policies.min_spend.drink).toBe(1);
    expect(written.policies.max_stay.unlimited).toBe(1);
  });

  it("recompute excludes soft-deleted rows via the query filter", async () => {
    const kept = makeCheckIn({
      id: "chk-1",
      scores: fullScores,
      visited_at: "2026-08-01T10:00:00Z",
    });

    const calls: { sql: string; params: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes("from checkins")) {
        // The SQL filters deleted_at is null; the mock honors it.
        return {
          rows: params?.[0] === "cafe-1" ? [kept] : [],
          rowCount: 1,
        } as unknown as QueryResult<CheckIn>;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult<Record<string, unknown>>;
    }) as unknown as <T extends Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<QueryResult<T>>;

    await recomputeWorkStats("cafe-1", query);

    const select = calls.find((c) => c.sql.includes("deleted_at is null"));
    expect(select).toBeDefined();
    const updateCall = calls.find((c) => c.sql.includes("update cafes"));
    const written = JSON.parse(updateCall!.params[0] as string) as ReturnType<
      typeof computeCafeStats
    >;
    expect(written.n_checkins).toBe(1);
  });
});
