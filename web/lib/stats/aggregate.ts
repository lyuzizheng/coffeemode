import "server-only";

import type { QueryResult } from "pg";
import type { CheckIn } from "@/types/checkins";

export type WorkDim = "wifi" | "outlets" | "seats" | "temp" | "coffee" | "overall";

export const WORK_DIMS: WorkDim[] = ["wifi", "outlets", "seats", "temp", "coffee", "overall"];

export const COMPOSITE_DIMS: Exclude<WorkDim, "overall">[] = [
  "wifi",
  "outlets",
  "seats",
  "temp",
  "coffee",
];

export const DIM_WEIGHTS: Record<Exclude<WorkDim, "overall">, number> = {
  wifi: 0.3,
  outlets: 0.2,
  seats: 0.2,
  temp: 0.15,
  coffee: 0.15,
};

export interface WorkStats {
  n_users: number;
  n_checkins: number;
  dims: Record<WorkDim, { sum: number; n: number }>;
  policies: {
    min_spend: Record<string, number>;
    max_stay: Record<string, number>;
  };
  experience_score: number | null;
  composite_score: number | null;
  updated_at: string;
}

interface UserContribution {
  dims: Record<WorkDim, number | undefined>;
  min_spend?: string;
  max_stay?: string;
}

export type QueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** Postgres row type with an index signature for the generic `query` helper. */
type DbCheckIn = CheckIn & Record<string, unknown>;

/** Build an empty work_stats payload. */
export function emptyWorkStats(): WorkStats {
  const dims = {} as Record<WorkDim, { sum: number; n: number }>;
  for (const dim of WORK_DIMS) {
    dims[dim] = { sum: 0, n: 0 };
  }
  return {
    n_users: 0,
    n_checkins: 0,
    dims,
    policies: { min_spend: {}, max_stay: {} },
    experience_score: null,
    composite_score: null,
    updated_at: new Date().toISOString(),
  };
}

function coerceWorkStats(raw: unknown): WorkStats {
  const partial = (raw ?? {}) as Partial<WorkStats>;
  const stats = emptyWorkStats();
  if (typeof partial.n_users === "number") stats.n_users = partial.n_users;
  if (typeof partial.n_checkins === "number") stats.n_checkins = partial.n_checkins;
  if (partial.policies) {
    if (partial.policies.min_spend) stats.policies.min_spend = { ...partial.policies.min_spend };
    if (partial.policies.max_stay) stats.policies.max_stay = { ...partial.policies.max_stay };
  }
  if (partial.dims) {
    for (const dim of WORK_DIMS) {
      const d = partial.dims[dim];
      if (d && typeof d.sum === "number" && typeof d.n === "number") {
        stats.dims[dim] = { sum: d.sum, n: d.n };
      }
    }
  }
  return stats;
}

function policyValue(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value;
}

function visitTimestamp(c: CheckIn): number {
  // Postgres may return timestamptz as a JS Date; `new Date` accepts both.
  return new Date(c.visited_at).getTime();
}

/**
 * Compute one user's contribution to a cafe.
 *
 * Scores are weighted by recency rank: newest = 0.6^0 = 1, previous = 0.6, …
 * When social_weight > 0, each weight is multiplied by
 * (1 + social_weight * normalized_likes) where normalized_likes is the
 * check-in's likes_count divided by that user's max likes_count in this set.
 * Missing dimensions are excluded from that dimension's weighted average.
 */
export function computeUserContribution(
  checkins: CheckIn[],
  socialWeight = 0,
): UserContribution {
  if (checkins.length === 0) {
    return { dims: { ...emptyDimValues() } };
  }

  const sorted = [...checkins].sort((a, b) => visitTimestamp(b) - visitTimestamp(a));
  const latest = sorted[0];

  const maxLikes = Math.max(0, ...sorted.map((c) => c.likes_count ?? 0));
  const useSocial = socialWeight > 0 && maxLikes > 0;

  const weights = sorted.map((c, rank) => {
    const base = Math.pow(0.6, rank);
    if (!useSocial) return base;
    const normalized = (c.likes_count ?? 0) / maxLikes;
    return base * (1 + socialWeight * normalized);
  });

  const dims = emptyDimValues();
  for (const dim of WORK_DIMS) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < sorted.length; i++) {
      const score = sorted[i].scores[dim];
      if (typeof score === "number") {
        weightedSum += score * weights[i];
        weightTotal += weights[i];
      }
    }
    dims[dim] = weightTotal > 0 ? weightedSum / weightTotal : undefined;
  }

  return {
    dims,
    min_spend: policyValue(latest.min_spend),
    max_stay: policyValue(latest.max_stay),
  };
}

function emptyDimValues(): Record<WorkDim, number | undefined> {
  const dims = {} as Record<WorkDim, number | undefined>;
  for (const dim of WORK_DIMS) {
    dims[dim] = undefined;
  }
  return dims;
}

function computeCompositeScore(stats: WorkStats): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const dim of COMPOSITE_DIMS) {
    const { sum, n } = stats.dims[dim];
    if (n > 0) {
      weighted += (sum / n) * DIM_WEIGHTS[dim];
      weightSum += DIM_WEIGHTS[dim];
    }
  }
  return weightSum > 0 ? weighted / weightSum : null;
}

function computeExperienceScore(stats: WorkStats): number | null {
  const { sum, n } = stats.dims.overall;
  return n > 0 ? sum / n : null;
}

function updatePolicyCount(
  counts: Record<string, number>,
  oldValue: string | undefined,
  newValue: string | undefined,
): void {
  if (oldValue !== undefined) {
    counts[oldValue] = (counts[oldValue] ?? 0) - 1;
    if (counts[oldValue] === 0) delete counts[oldValue];
  }
  if (newValue !== undefined) {
    counts[newValue] = (counts[newValue] ?? 0) + 1;
  }
}

function isUserPresent(contribution: UserContribution | null): boolean {
  return contribution !== null && contribution.dims.overall !== undefined;
}

/**
 * Apply the difference between a user's old and new contribution to a cafe's
 * work_stats. Passing `null` for old means the user is new; passing `null` for
 * new means the user is removed.
 */
export function applyUserContributionDiff(
  stats: WorkStats,
  oldContribution: UserContribution | null,
  newContribution: UserContribution | null,
  nCheckins: number,
): WorkStats {
  const next = {
    ...stats,
    dims: { ...stats.dims },
    policies: {
      min_spend: { ...stats.policies.min_spend },
      max_stay: { ...stats.policies.max_stay },
    },
  };
  for (const dim of WORK_DIMS) {
    next.dims[dim] = { ...stats.dims[dim] };
  }

  for (const dim of WORK_DIMS) {
    const oldVal = oldContribution?.dims[dim];
    const newVal = newContribution?.dims[dim];
    const entry = next.dims[dim];
    if (oldVal !== undefined) {
      entry.sum -= oldVal;
      entry.n -= 1;
    }
    if (newVal !== undefined) {
      entry.sum += newVal;
      entry.n += 1;
    }
  }

  next.n_users +=
    (isUserPresent(newContribution) ? 1 : 0) - (isUserPresent(oldContribution) ? 1 : 0);
  next.n_checkins = nCheckins;

  updatePolicyCount(
    next.policies.min_spend,
    oldContribution?.min_spend,
    newContribution?.min_spend,
  );
  updatePolicyCount(
    next.policies.max_stay,
    oldContribution?.max_stay,
    newContribution?.max_stay,
  );

  next.experience_score = computeExperienceScore(next);
  next.composite_score = computeCompositeScore(next);
  next.updated_at = new Date().toISOString();

  return next;
}

/**
 * Recompute the work_stats for a cafe from all of its non-deleted check-ins.
 * This is the correct path for edits, soft-deletes, and the nightly drift
 * correction recompute (spec 0001 §Aggregation).
 */
export async function recomputeWorkStats(
  cafeId: string,
  query: QueryFn,
  socialWeight = 0,
): Promise<void> {
  const { rows } = await query<DbCheckIn>(
    `select id, cafe_id, user_id, is_creation, scores, min_spend, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and deleted_at is null
     order by visited_at desc`,
    [cafeId],
  );

  const stats = computeCafeStats(rows, socialWeight);
  await writeWorkStats(cafeId, stats, query);
}

/**
 * Recompute every cafe's work_stats. Intended for the nightly cron job.
 */
export async function recomputeAllWorkStats(
  query: QueryFn,
  socialWeight = 0,
): Promise<void> {
  const { rows } = await query<{ id: string }>("select id from cafes", []);
  for (const { id } of rows) {
    await recomputeWorkStats(id, query, socialWeight);
  }
}

/**
 * Incrementally update a cafe's work_stats after a single check-in write.
 *
 * `changedCheckIn` is the row just inserted/updated. If omitted, the user's
 * most recent non-deleted check-in at the cafe is treated as the changed one.
 * For edits or soft-deletes, use `recomputeWorkStats` instead.
 */
export async function incrementalUpdateWorkStats(
  cafeId: string,
  userId: string,
  query: QueryFn,
  changedCheckIn?: CheckIn,
  socialWeight = 0,
): Promise<void> {
  const { rows: userRows } = await query<DbCheckIn>(
    `select id, cafe_id, user_id, is_creation, scores, min_spend, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and user_id = $2 and deleted_at is null
     order by visited_at desc, created_at desc`,
    [cafeId, userId],
  );

  const changedId = changedCheckIn?.id;
  const changedInDb = changedId ? userRows.some((r) => r.id === changedId) : false;

  // Rows before this write: exclude the changed row if it is already persisted.
  const priorRows = changedInDb ? userRows.filter((r) => r.id !== changedId) : userRows;

  // Rows after this write: include the changed row with its new values.
  const newRows = changedCheckIn
    ? changedInDb
      ? userRows
      : [changedCheckIn, ...userRows]
    : userRows;

  const oldContribution = computeUserContribution(priorRows, socialWeight);
  const newContribution = computeUserContribution(newRows, socialWeight);

  const { rows: cafeRows } = await query<{ work_stats: unknown }>(
    "select work_stats from cafes where id = $1",
    [cafeId],
  );
  const currentStats = coerceWorkStats(cafeRows[0]?.work_stats);

  const { rows: countRows } = await query<{ n: number }>(
    "select count(*)::int as n from checkins where cafe_id = $1 and deleted_at is null",
    [cafeId],
  );
  const nCheckins = (countRows[0]?.n ?? 0) + (changedCheckIn && !changedInDb ? 1 : 0);

  const nextStats = applyUserContributionDiff(currentStats, oldContribution, newContribution, nCheckins);
  await writeWorkStats(cafeId, nextStats, query);
}

/** Pure helper to build work_stats from an array of non-deleted check-ins. */
export function computeCafeStats(checkins: CheckIn[], socialWeight = 0): WorkStats {
  const byUser = new Map<string, CheckIn[]>();
  for (const c of checkins) {
    const list = byUser.get(c.user_id) ?? [];
    list.push(c);
    byUser.set(c.user_id, list);
  }

  let stats = emptyWorkStats();
  for (const [, userCheckins] of byUser) {
    const contribution = computeUserContribution(userCheckins, socialWeight);
    stats = applyUserContributionDiff(stats, null, contribution, checkins.length);
  }

  stats.n_checkins = checkins.length;
  stats.n_users = byUser.size;
  return stats;
}

async function writeWorkStats(
  cafeId: string,
  stats: WorkStats,
  query: QueryFn,
): Promise<void> {
  await query(
    "update cafes set work_stats = $1, updated_at = now() where id = $2",
    [JSON.stringify(stats), cafeId],
  );
}
