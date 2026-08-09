/**
 * Work-stats persistence — the SQL surface. Pure math lives in
 * `lib/stats/work-stats.ts`; this file only wires it to Postgres.
 * (Review 2026-08-09 C7: split 372-line monolith.)
 */
import "server-only";

import type { QueryResult } from "pg";
import type { CheckIn } from "@/types/checkins";
import {
  applyUserContributionDiff,
  coerceWorkStats,
  computeCafeStats,
  computeUserContribution,
  type WorkStats,
} from "./work-stats";

export type { WorkStats } from "./work-stats";
export {
  COMPOSITE_DIMS,
  DIM_WEIGHTS,
  WORK_DIMS,
  applyUserContributionDiff,
  coerceWorkStats,
  computeCafeStats,
  computeUserContribution,
  emptyWorkStats,
} from "./work-stats";

export type QueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/** Postgres row type with an index signature for the generic `query` helper. */
type DbCheckIn = CheckIn & Record<string, unknown>;

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
