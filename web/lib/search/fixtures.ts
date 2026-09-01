import "server-only";

/**
 * DG140 — fixtures double-gate (备选挂载方案).
 * Enabled only when SEARCH_FIXTURES=1 && NODE_ENV !== "production".
 * Branch logic isolated here so prod bundle never does per-request readFile.
 * Consumers: `web/app/api/search/route.ts` (Stage 2 wiring) and `theme-preview`/MSW.
 */
export function isFixturesEnabled(): boolean {
  return process.env.SEARCH_FIXTURES === "1" && process.env.NODE_ENV !== "production";
}

// Minimal deterministic fixtures stub — full JSON file lands in Stage 2 (`web/tests/fixtures/search-fixtures.json`).
// Keeping the loader here avoids scattering `process.env` checks and readFile calls.
export interface SearchFixtures {
  cafes: unknown[];
  pois: unknown[];
}

export function getSearchFixtures(): SearchFixtures | null {
  if (!isFixturesEnabled()) return null;
  // Stage 2 will read `web/tests/fixtures/search-fixtures.json` via fs; return empty stub for now to satisfy type-check.
  return { cafes: [], pois: [] };
}
