import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { CafeSummary } from "@/types/cafes";
import type { POI } from "@shared/places/types";
import type { SearchResultSource } from "./types";

/**
 * DG140 — fixtures double-gate (备选挂载方案).
 * Enabled only when SEARCH_FIXTURES=1 && NODE_ENV !== "production".
 * Branch logic isolated here so prod bundle never does per-request readFile.
 * Consumers: `web/app/api/search/route.ts` (Stage 2 wiring) and `theme-preview`/MSW.
 */
export function isFixturesEnabled(): boolean {
  return process.env.SEARCH_FIXTURES === "1" && process.env.NODE_ENV !== "production";
}
export interface SearchFixtures {
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
    console.error("Failed to load search fixtures", err);
  }
  return null;
}
