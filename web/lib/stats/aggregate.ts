/**
 * Work-stats persistence — the SQL surface. Pure math lives in
 * `lib/stats/work-stats.ts`; this file only wires it to Postgres.
 * (Review 2026-08-09 C7: split 372-line monolith.)
 */
import "server-only";

import type { RunInTransaction, TxQueryFn } from "@/lib/db/postgres";
import type { CheckIn } from "@/types/checkins";
import { appConfig } from "@/lib/config";
import {
  applyUserContributionDiff,
  coerceWorkStats,
  computeCafeStats,
  computeUserContribution,
  type WorkStats,
} from "./work-stats";

export type { DimWeights, WorkStats } from "./work-stats";
export {
  COMPOSITE_DIMS,
  WORK_DIMS,
  applyUserContributionDiff,
  coerceWorkStats,
  computeCafeStats,
  computeUserContribution,
  emptyWorkStats,
} from "./work-stats";

/**
 * Transaction-scoped query function for this module's signatures.
 * Canonical shape lives in `lib/db/postgres` (spec 0009 §Edge cases 6).
 */
type QueryFn = TxQueryFn;

export type { RunInTransaction };

/**
 * Default transaction runner backed by the shared Postgres pool.
 *
 * The `pg` module graph is imported lazily so unit tests (which inject their
 * own runner) and the memory-only dev path never load the driver — same
 * pattern as the rate limiter's lazy backend (issue #23).
 */
function defaultRunInTransaction(): RunInTransaction {
  return async (fn) => {
    const { withTransaction, txQueryFrom } = await import("@/lib/db/postgres");
    return withTransaction((client) => fn(txQueryFrom(client)));
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
      `select id, cafe_id, user_id, is_creation, scores, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and deleted_at is null
     order by visited_at desc, created_at desc, id desc`,
      [cafeId],
    );

    const stats = computeCafeStats(
      rows,
      socialWeight,
      appConfig.stats.recencyDecay,
      appConfig.stats.dimWeights,
    );
    await writeWorkStats(cafeId, stats, q);
  });
}

/**
 * Recompute every cafe's work_stats. Intended for the nightly cron job.
 *
 * Cafes are recomputed through a small worker pool (RECOMPUTE_CONCURRENCY)
 * instead of one serial pass: each cafe still gets its own transaction and
 * FOR UPDATE lock via `recomputeWorkStats`, so per-cafe semantics are
 * unchanged — only the throughput changes (BRAWUKA-652). On the first
 * failure the pool stops taking new work, lets in-flight recomputes settle,
 * then rethrows that error.
 */
export async function recomputeAllWorkStats(
  query: QueryFn,
  socialWeight = 0,
  runInTransaction: RunInTransaction = defaultRunInTransaction(),
): Promise<void> {
  const { rows } = await query<{ id: string }>(
    "select id from cafes where deleted_at is null",
    [],
  );

  let next = 0;
  let stopped = false;
  let firstError: unknown;
  const worker = async () => {
    while (!stopped) {
      const i = next++;
      if (i >= rows.length) return;
      try {
        await recomputeWorkStats(rows[i].id, socialWeight, runInTransaction);
      } catch (err) {
        stopped = true;
        firstError ??= err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RECOMPUTE_CONCURRENCY, rows.length) }, worker),
  );
  if (firstError !== undefined) throw firstError;
}

/** Max cafes recomputed concurrently by `recomputeAllWorkStats`. */
const RECOMPUTE_CONCURRENCY = 4;

/**
 * Incrementally update a cafe's work_stats after a single check-in insert.
 *
 * `changedCheckIn.insertedId` is the row just INSERTed in this transaction,
 * so the DB snapshot is the "after" state — the "before" set is the snapshot
 * minus that row. Correct for any `visited_at` (including backdated) because
 * the contribution math re-sorts by `visited_at` internally.
 *
 * The parameter is required (BRAWUKA-444): the old optional form treated the
 * most recent snapshot row as the changed one (`slice(1)`), which is only
 * correct when the changed row happens to be the latest — a future caller
 * passing nothing for a non-first/backfilled check-in would silently
 * miscompute. A full `CheckIn` row is likewise not accepted: passing an
 * already-persisted row computed a zero diff and skipped the update.
 * Edits and soft-deletes must use `recomputeWorkStats` instead.
 *
 * The whole read-modify-write runs in a transaction with a `FOR UPDATE` lock
 * on the cafe row: two concurrent check-ins for the same cafe serialize on
 * the lock, and the second transaction re-reads after the first commits, so
 * no contribution is lost (issue #27).
 */
export async function incrementalUpdateWorkStats(
  cafeId: string,
  userId: string,
  changedCheckIn: { insertedId: string },
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
    const currentStats = coerceWorkStats(cafeRows[0]?.work_stats, appConfig.stats.dimWeights);

    const { rows: userRows } = await q<DbCheckIn>(
      `select id, cafe_id, user_id, is_creation, scores, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins
     where cafe_id = $1 and user_id = $2 and deleted_at is null
     order by visited_at desc, created_at desc, id desc`,
      [cafeId, userId],
    );

    const { priorRows, newRows, changedInDb } = resolveChangedRowSets(userRows, changedCheckIn);

    const oldContribution = computeUserContribution(
      priorRows,
      socialWeight,
      appConfig.stats.recencyDecay,
    );
    const newContribution = computeUserContribution(
      newRows,
      socialWeight,
      appConfig.stats.recencyDecay,
    );

    const { rows: countRows } = await q<{ n: number }>(
      "select count(*)::int as n from checkins where cafe_id = $1 and deleted_at is null",
      [cafeId],
    );
    const nCheckins = (countRows[0]?.n ?? 0) + (!changedInDb ? 1 : 0);

    const nextStats = applyUserContributionDiff(
      currentStats,
      oldContribution,
      newContribution,
      nCheckins,
      appConfig.stats.dimWeights,
    );
    await writeWorkStats(cafeId, nextStats, q);
  });
}

/**
 * Resolve the "before" and "after" row sets for one user from the DB
 * snapshot (`userRows`, live check-ins ordered by visited_at desc) and the
 * just-inserted row id: userRows is the post-insert snapshot; the "before"
 * set excludes it. Correct for backdated `visited_at` —
 * `computeUserContribution` re-sorts by `visited_at`, so the new row takes
 * its true recency rank instead of assuming it is the latest.
 */
function resolveChangedRowSets(
  userRows: CheckIn[],
  changedCheckIn: { insertedId: string },
): { priorRows: CheckIn[]; newRows: CheckIn[]; changedInDb: boolean } {
  const { insertedId } = changedCheckIn;
  const changedInDb = userRows.some((r) => r.id === insertedId);
  return {
    priorRows: userRows.filter((r) => r.id !== insertedId),
    newRows: userRows,
    changedInDb,
  };
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
