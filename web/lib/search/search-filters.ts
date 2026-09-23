/**
 * Search filter state model (search-filters-v1 §4, DG44–DG58).
 *
 * One object is the single source of truth for the Filter button badge, the
 * removable chips row, the panel controls, the emitted `filter_*` params,
 * and the `?`-synced URL — they can never disagree because every surface
 * derives from `SearchFilterState`.
 *
 * URL contract (DG48): `Any` means "no threshold" — the parameter is omitted
 * entirely, so a clean state produces a clean query string. Tri-state segment
 * values (60/80) represent the UI controls, but any valid 0-100 score
 * round-trips to preserve deep-link filter state across SSR and client
 * surfaces (BRAWUKA-589).
 */
import type { WorkDim } from "@/lib/stats/work-stats";
import { WORK_DIMS } from "@/lib/stats/work-stats";

/** Tri-state segment values (spec §4): `Any` omits the param. */
export const DIM_THRESHOLDS = [60, 80] as const;
export type DimThreshold = (typeof DIM_THRESHOLDS)[number];

/** Max-stay filter options — `unknown` is deliberately not offered (spec §4:
 * filtering by "unknown" selects cafes with no data; a research tool, not a
 * nomad tool). */
export const MAX_STAY_FILTER_VALUES = ["unlimited", "3h", "2h", "1h", "peak"] as const;
export type MaxStayFilter = (typeof MAX_STAY_FILTER_VALUES)[number];

export interface SearchFilterState {
  /** `open_now` — default OFF (DG53). */
  openNow: boolean;
  /** Per-dimension minimum score; absent = `Any`. Accepts tri-state (60/80) or custom 0-100 scores. */
  thresholds: Partial<Record<WorkDim, number>>;
  /** `filter_max_stay`; absent = `Any`. */
  maxStay: MaxStayFilter | null;
}

export const EMPTY_FILTERS: SearchFilterState = {
  openNow: false,
  thresholds: {},
  maxStay: null,
};

const DIM_PARAM: Record<WorkDim, string> = {
  wifi: "filter_wifi",
  outlets: "filter_outlets",
  seats: "filter_seats",
  temp: "filter_temp",
  coffee: "filter_coffee",
  overall: "filter_overall",
};

export function isDimThreshold(value: number): value is DimThreshold {
  return (DIM_THRESHOLDS as readonly number[]).includes(value);
}

function parseScore(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > 100) return undefined;
  return num;
}

function isMaxStayFilter(value: string): value is MaxStayFilter {
  return (MAX_STAY_FILTER_VALUES as readonly string[]).includes(value);
}

/** Decode `?open_now=&filter_*=` into state; out-of-range scores drop. */
export function filtersFromSearchParams(params: URLSearchParams): SearchFilterState {
  const state: SearchFilterState = {
    openNow: params.get("open_now") === "true",
    thresholds: {},
    maxStay: null,
  };
  for (const dim of WORK_DIMS) {
    const score = parseScore(params.get(DIM_PARAM[dim]));
    if (score !== undefined) state.thresholds[dim] = score;
  }
  const maxStay = params.get("filter_max_stay");
  if (maxStay !== null && isMaxStayFilter(maxStay)) state.maxStay = maxStay;
  return state;
}

/** Encode state into `params` (mutates). `Any` positions emit nothing. */
export function filtersToSearchParams(
  state: SearchFilterState,
  params: URLSearchParams,
): void {
  if (state.openNow) params.set("open_now", "true");
  for (const dim of WORK_DIMS) {
    const threshold = state.thresholds[dim];
    if (threshold !== undefined) params.set(DIM_PARAM[dim], String(threshold));
  }
  if (state.maxStay !== null) params.set("filter_max_stay", state.maxStay);
}

/** Active-filter count — the Filter button badge (`· 3`) and the chips row. */
export function countActiveFilters(state: SearchFilterState): number {
  return (
    (state.openNow ? 1 : 0) +
    Object.keys(state.thresholds).length +
    (state.maxStay !== null ? 1 : 0)
  );
}

export function hasActiveFilters(state: SearchFilterState): boolean {
  return countActiveFilters(state) > 0;
}
