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

/**
 * Runs `fn` on a single connection inside a transaction (BEGIN/COMMIT/ROLLBACK).
 * The callback receives the transaction-scoped query function.
 */
export type RunInTransaction = <T>(fn: (q: QueryFn) => Promise<T>) => Promise<T>;

/**
 * Default transaction runner backed by the shared Postgres pool.
 *
 * The `pg` module graph is imported lazily so unit tests (which inject their
 * own runner) and the memory-only dev path never load the driver — same
 * pattern as the rate limiter's lazy backend (issue #23).
 */
export function defaultRunInTransaction(): RunInTransaction {
  return async (fn) => {
    const { withTransaction } = await import("@/lib/db/postgres");
    return withTransaction(async (client) => fn(client.query.bind(client) as QueryFn));
  };
}

/** Postgres row type with an index signature for the generic `query` helper. */
type DbCheckIn = CheckIn & Record<string, unknown>;

/**
 * Recompute the work_stats for a cafe from all of its non-deleted check-ins.
 * This is the correct path for edits, soft-deletes, and the nightly drift
 * correction recompute (spec 0001 §Aggregation).
 *
 * Runs in a transaction with a `FOR UPDATE` lock on the cafe row so a
 * concurrent incremental update cannot interleave with the recompute and
 * lose a contribution (issue #27).
 */
export async function recomputeWorkStats(
  cafeId: string,
  socialWeight = 0,
  runInTransaction: RunInTransaction = defaultRunInTransaction(),
): Promise<void> {
  await runInTransaction(async (q) => {
    // Lock first: serializes against incrementalUpdateWorkStats and other
    // recomputes for the same cafe for the whole transaction.
    await q("select 1 from cafes where id = $1 for update", [cafeId]);

    const { rows } = await q<DbCheckIn>(
      `select id, cafe_id, user_id, is_creation, scores, min_spend, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and deleted_at is null
     order by visited_at desc`,
      [cafeId],
    );

    const stats = computeCafeStats(rows, socialWeight);
    await writeWorkStats(cafeId, stats, q);
  });
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
    await recomputeWorkStats(id, socialWeight);
  }
}

/**
 * Incrementally update a cafe's work_stats after a single check-in write.
 *
 * `changedCheckIn` is the row just inserted/updated. If omitted, the user's
 * most recent non-deleted check-in at the cafe is treated as the changed one.
 * For edits or soft-deletes, use `recomputeWorkStats` instead.
 *
 * The whole read-modify-write runs in a transaction with a `FOR UPDATE` lock
 * on the cafe row: two concurrent check-ins for the same cafe serialize on
 * the lock, and the second transaction re-reads after the first commits, so
 * no contribution is lost (issue #27).
 */
export async function incrementalUpdateWorkStats(
  cafeId: string,
  userId: string,
  changedCheckIn?: CheckIn,
  socialWeight = 0,
  runInTransaction: RunInTransaction = defaultRunInTransaction(),
): Promise<void> {
  await runInTransaction(async (q) => {
    // Lock + read in one statement. Held until COMMIT, so a concurrent
    // check-in or recompute for the same cafe waits and then sees the
    // committed state (READ COMMITTED takes a fresh snapshot per statement).
    const { rows: cafeRows } = await q<{ work_stats: unknown }>(
      "select work_stats from cafes where id = $1 for update",
      [cafeId],
    );
    const currentStats = coerceWorkStats(cafeRows[0]?.work_stats);

    const { rows: userRows } = await q<DbCheckIn>(
      `select id, cafe_id, user_id, is_creation, scores, min_spend, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and user_id = $2 and deleted_at is null
     order by visited_at desc, created_at desc`,
      [cafeId, userId],
    );

    const changedId = changedCheckIn?.id;
    const changedInDb = changedId ? userRows.some((r) => r.id === changedId) : false;

    // Determine the "before" and "after" row sets for this user.
    // - If changedCheckIn is omitted, the most recent non-deleted check-in is
    //   treated as the one that changed (it is already in userRows).
    // - If changedCheckIn is provided, userRows is assumed to be the old DB
    //   snapshot for this user; the supplied row replaces the old one.
    // - For edits/soft-deletes where the old snapshot is not available, use
    //   `recomputeWorkStats` instead.
    let priorRows: CheckIn[];
    let newRows: CheckIn[];
    if (!changedCheckIn) {
      priorRows = userRows.length > 0 ? userRows.slice(1) : userRows;
      newRows = userRows;
    } else if (changedInDb) {
      const otherRows = userRows.filter((r) => r.id !== changedId);
      priorRows = userRows;
      newRows = [changedCheckIn, ...otherRows];
    } else {
      priorRows = userRows;
      newRows = [changedCheckIn, ...userRows];
    }

    const oldContribution = computeUserContribution(priorRows, socialWeight);
    const newContribution = computeUserContribution(newRows, socialWeight);

    const { rows: countRows } = await q<{ n: number }>(
      "select count(*)::int as n from checkins where cafe_id = $1 and deleted_at is null",
      [cafeId],
    );
    const nCheckins = (countRows[0]?.n ?? 0) + (changedCheckIn && !changedInDb ? 1 : 0);

    const nextStats = applyUserContributionDiff(currentStats, oldContribution, newContribution, nCheckins);
    await writeWorkStats(cafeId, nextStats, q);
  });
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
