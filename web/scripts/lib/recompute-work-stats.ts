/**
 * Nightly work_stats recompute — CLI entry over the canonical TS path.
 *
 * This file is the esbuild entry point bundled by
 * `scripts/recompute-work-stats.mjs` into `scripts/dist/`. It deliberately
 * contains no stats math: `recomputeAllWorkStats` (lib/stats/aggregate.ts)
 * is the single implementation — per-cafe FOR UPDATE transaction plus the
 * RECOMPUTE_CONCURRENCY=4 worker pool (BRAWUKA-652). The previous plain-.mjs
 * re-implementation drifted from it (no socialWeight, stale weight literals),
 * which is why the script now compiles this path instead (BRAWUKA-664).
 *
 * Failure semantics: the worker pool stops on the first cafe error and
 * rethrows, so the process exits non-zero and the cron wrapper alerts —
 * same contract the serial loop provided, without per-cafe error
 * aggregation (a failed run is retried wholesale; recompute is idempotent).
 */
import { closePool, query } from "@/lib/db/postgres";
import { recomputeAllWorkStats } from "@/lib/stats/aggregate";

/** Local dev default — matches docker-compose.yml (postgis/postgis). */
const DEFAULT_DATABASE_URL =
  "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

async function main(): Promise<void> {
  // Set before the pool is lazily created; getPoolConfig reads env at call
  // time, so this also covers containers that inject DATABASE_URL.
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;

  const { rows } = await query<{ count: string }>(
    "select count(*)::text as count from cafes where deleted_at is null",
  );
  console.log(`recompute: ${rows[0]?.count ?? "?"} cafe(s)`);

  await recomputeAllWorkStats(query);
  console.log("done: recompute finished");
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool().catch(() => {});
  });
