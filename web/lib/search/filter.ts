import { isOpenAt } from "@/lib/hours";
import type { WorkDim, WorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import type { MaxStay } from "@/types/checkins";
import type { SearchFilters } from "./types";

export const WORK_DIM_FILTER_MAP = [
  { key: "filter_wifi", dim: "wifi" },
  { key: "filter_outlets", dim: "outlets" },
  { key: "filter_seats", dim: "seats" },
  { key: "filter_temp", dim: "temp" },
  { key: "filter_coffee", dim: "coffee" },
  { key: "filter_overall", dim: "overall" },
] as const;

export const MAX_STAY_ORDER: Record<MaxStay, number> = {
  unknown: -1,
  peak: 0,
  "1h": 1,
  "2h": 2,
  "3h": 3,
  unlimited: 4,
};

export function getDimensionAverage(
  stats: WorkStats,
  dim: WorkDim,
): number | null {
  if (dim === "overall") {
    if (stats.experience_score !== null) return stats.experience_score;
    const entry = stats.dims.overall;
    return entry && entry.n > 0 ? entry.sum / entry.n : null;
  }
  const entry = stats.dims[dim];
  return entry && entry.n > 0 ? entry.sum / entry.n : null;
}

export function matchesWorkDimension(
  stats: WorkStats,
  dim: WorkDim,
  threshold: number,
): boolean {
  const avg = getDimensionAverage(stats, dim);
  if (avg === null) return false;
  return avg >= threshold;
}

export function getConsensusOption(
  counts: Record<string, number> | undefined,
): string | null {
  if (!counts) return null;
  let maxKey: string | null = null;
  let maxVal = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > maxVal) {
      maxVal = count;
      maxKey = key;
    }
  }
  return maxKey;
}

export function matchesMaxStay(
  stats: WorkStats,
  maxStay: MaxStay,
): boolean {
  const consensus = getConsensusOption(stats.policies?.max_stay) as MaxStay | null;
  if (!consensus || MAX_STAY_ORDER[consensus] === undefined) return false;
  if (maxStay === "peak") return consensus === "peak";
  // Ordinal "at least": cafe's allowed stay must be >= user's desired stay duration.
  return MAX_STAY_ORDER[consensus] >= MAX_STAY_ORDER[maxStay];
}

export function matchesAllFilters(
  cafe: CafeSummary,
  filters: SearchFilters,
  instant?: Date,
): boolean {
  const stats = cafe.work_stats;

  for (const { key, dim } of WORK_DIM_FILTER_MAP) {
    const threshold = filters[key];
    if (threshold !== undefined && !matchesWorkDimension(stats, dim, threshold)) {
      return false;
    }
  }

  if (filters.filter_max_stay !== undefined) {
    if (!matchesMaxStay(stats, filters.filter_max_stay)) return false;
  }
  if (filters.open_now) {
    if (isOpenAt(cafe.opening_hours, cafe.tz, instant) !== true) return false;
  }

  return true;
}

export function hasWorkFiltersActive(filters: SearchFilters): boolean {
  return (
    WORK_DIM_FILTER_MAP.some(({ key }) => filters[key] !== undefined) ||
    filters.filter_max_stay !== undefined
  );
}
