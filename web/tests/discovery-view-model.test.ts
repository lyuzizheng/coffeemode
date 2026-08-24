import { describe, expect, it } from "vitest";
import {
  cafeFacts,
  dedupeCheckins,
  dimMean,
  formatDistanceKm,
  policyConsensus,
} from "@/lib/discovery/view-model";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import type { CheckInFeedPage, PublicCheckIn } from "@/types/checkins";

function statsWith(overrides: (stats: ReturnType<typeof emptyWorkStats>) => void) {
  const stats = emptyWorkStats();
  overrides(stats);
  return stats;
}

function cafeWith(stats: ReturnType<typeof emptyWorkStats>): CafeSummary {
  return {
    id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    slug: null,
    name: "Test Cafe",
    lat: 1.35,
    lng: 103.8,
    address: null,
    city: "singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: null,
    work_stats: stats,
    cover: null,
  };
}

describe("dimMean", () => {
  it("rounds the mean and returns null for zero responses", () => {
    const stats = statsWith((s) => {
      s.dims.wifi = { sum: 173, n: 2 }; // 86.5 → 87
    });
    expect(dimMean(stats, "wifi")).toBe(87);
    expect(dimMean(stats, "seats")).toBeNull();
  });
});

describe("policyConsensus", () => {
  it("picks the most-answered value and nulls when empty", () => {
    const stats = statsWith((s) => {
      s.policies.max_stay = { "3h": 4, unlimited: 2 };
    });
    expect(policyConsensus(stats, "max_stay")).toBe("3h");
    expect(policyConsensus(stats, "min_spend")).toBeNull();
  });
});

describe("cafeFacts", () => {
  it("orders by artifact priority, caps at 4, and collapses missing data", () => {
    const stats = statsWith((s) => {
      s.dims.wifi = { sum: 87, n: 1 };
      s.dims.outlets = { sum: 72, n: 1 };
      s.dims.seats = { sum: 64, n: 1 };
      s.dims.temp = { sum: 70, n: 1 };
      s.dims.coffee = { sum: 81, n: 1 };
      s.policies.max_stay = { "3h": 3 };
    });
    // wifi, outlets, stay, seats — coffee/temp fall off the cap.
    expect(cafeFacts(cafeWith(stats))).toEqual([
      { kind: "wifi", value: "87" },
      { kind: "outlets", value: "72" },
      { kind: "stay", value: "3h" },
      { kind: "seats", value: "64" },
    ]);
  });

  it("skips an unknown stay consensus and zero-response dims", () => {
    const stats = statsWith((s) => {
      s.policies.max_stay = { unknown: 2 };
      s.dims.coffee = { sum: 81, n: 1 };
    });
    expect(cafeFacts(cafeWith(stats))).toEqual([{ kind: "coffee", value: "81" }]);
  });

  it("renders nothing when there is no data at all", () => {
    expect(cafeFacts(cafeWith(emptyWorkStats()))).toEqual([]);
  });
});

describe("formatDistanceKm", () => {
  it("formats meters as one-decimal km and passes nulls through", () => {
    expect(formatDistanceKm(1234)).toBe("1.2");
    expect(formatDistanceKm(undefined)).toBeNull();
    expect(formatDistanceKm(NaN)).toBeNull();
  });
});

function checkin(id: string): PublicCheckIn {
  return {
    id,
    scores: {},
    min_spend: null,
    max_stay: null,
    note: null,
    photos: [],
    likes_count: 0,
    liked_by_viewer: false,
    visited_at: "2026-08-01T10:00:00.000Z",
  };
}

describe("dedupeCheckins", () => {
  it("keeps the first occurrence when a row moves between pages", () => {
    const pages: CheckInFeedPage[] = [
      { checkins: [checkin("a"), checkin("b")], nextCursor: "c1" },
      { checkins: [checkin("b"), checkin("c")], nextCursor: null },
    ];
    expect(dedupeCheckins(pages).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
