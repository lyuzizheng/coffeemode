import { isOpenAt } from "@/lib/hours";
import type { WorkDim, WorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import type { MaxStay, MinSpend } from "@/types/checkins";
import type { SearchFilters } from "./types";

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

export function getConsensusPolicy(
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

export function matchesMinSpend(
  stats: WorkStats,
  minSpend: MinSpend,
): boolean {
  const consensus = getConsensusPolicy(stats.policies?.min_spend);
  if (!consensus) return false;
  return consensus === minSpend;
}

export function matchesMaxStay(
  stats: WorkStats,
  maxStay: MaxStay,
): boolean {
  const consensus = getConsensusPolicy(stats.policies?.max_stay);
  if (!consensus) return false;
  return consensus === maxStay;
}

export function matchesAllFilters(
  cafe: CafeSummary,
  filters: SearchFilters,
  instant?: Date,
): boolean {
  const stats = cafe.work_stats;

  if (filters.filter_wifi !== undefined) {
    if (!matchesWorkDimension(stats, "wifi", filters.filter_wifi)) return false;
  }
  if (filters.filter_outlets !== undefined) {
    if (!matchesWorkDimension(stats, "outlets", filters.filter_outlets)) return false;
  }
  if (filters.filter_seats !== undefined) {
    if (!matchesWorkDimension(stats, "seats", filters.filter_seats)) return false;
  }
  if (filters.filter_temp !== undefined) {
    if (!matchesWorkDimension(stats, "temp", filters.filter_temp)) return false;
  }
  if (filters.filter_coffee !== undefined) {
    if (!matchesWorkDimension(stats, "coffee", filters.filter_coffee)) return false;
  }
  if (filters.filter_overall !== undefined) {
    if (!matchesWorkDimension(stats, "overall", filters.filter_overall)) return false;
  }
  if (filters.filter_min_spend !== undefined) {
    if (!matchesMinSpend(stats, filters.filter_min_spend)) return false;
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
    filters.filter_wifi !== undefined ||
    filters.filter_outlets !== undefined ||
    filters.filter_seats !== undefined ||
    filters.filter_temp !== undefined ||
    filters.filter_coffee !== undefined ||
    filters.filter_overall !== undefined ||
    filters.filter_min_spend !== undefined ||
    filters.filter_max_stay !== undefined
  );
}
