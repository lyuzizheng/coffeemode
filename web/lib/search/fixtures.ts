import { logError } from "@/lib/observability/server-log";
import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { CafeSummary } from "@/types/cafes";
import type { POI } from "@shared/places/types";
import type { SearchResponse, SearchResultItem, SearchResultSource } from "./types";

/**
 * DG140 — fixtures double-gate (备选挂载方案).
 * Enabled only when SEARCH_FIXTURES=1 && NODE_ENV !== "production".
 * Branch logic isolated here so prod bundle never does per-request readFile.
 * Consumers: `web/app/api/search/route.ts` (Stage 2 wiring) and `theme-preview`/MSW.
 */
export function isFixturesEnabled(): boolean {
  return process.env.SEARCH_FIXTURES === "1" && process.env.NODE_ENV !== "production";
}
interface SearchFixtures {
  cafes: CafeSummary[];
  pois: Array<POI & { search_source?: SearchResultSource }>;
}

export function getSearchFixtures(): SearchFixtures | null {
  if (!isFixturesEnabled()) return null;
  try {
    const candidatePaths = [
      path.join(process.cwd(), "tests/fixtures/search-fixtures.json"),
      path.join(process.cwd(), "web/tests/fixtures/search-fixtures.json"),
    ];
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf-8");
        return JSON.parse(raw) as SearchFixtures;
      }
    }
  } catch (err) {
    logError({ route: "search fixtures", error: err });
  }
  return null;
}

/**
 * Deterministic fixture payload shared by `GET /api/search?fixtures=1` and
 * the SSR `/search?fixtures=1` page — same shape as `executeSearch` output so
 * visual smoke exercises the real render path (DG140).
 */
export function fixtureSearchResponse(fixtures: SearchFixtures): SearchResponse {
  const results: SearchResultItem[] = [
    ...fixtures.cafes.map((cafe) => ({
      id: cafe.id,
      type: "cafe" as const,
      source: "coffeemode" as const,
      name: cafe.name,
      address: cafe.address,
      lat: cafe.lat,
      lng: cafe.lng,
      distance_m: null,
      is_from_city_center: false,
      cafe,
    })),
    ...fixtures.pois.map((poi) => ({
      id: poi.place_id,
      type: "poi" as const,
      source: (poi.search_source ?? (poi.source === "apple" ? "apple" : "stored_poi")) as SearchResultSource,
      name: poi.name,
      address: poi.address,
      lat: poi.lat,
      lng: poi.lng,
      distance_m: null,
      is_from_city_center: false,
      poi,
    })),
  ];
  return {
    results,
    total_count: results.length,
    is_weak_results: results.length < 3,
    reference_point: {
      lat: 1.285,
      lng: 103.85,
      is_from_city_center: false,
      city_id: "singapore",
      city_name: "Singapore",
    },
  };
}
