#!/usr/bin/env node
/**
 * CoffeeMode work_stats nightly recompute — idempotent drift correction.
 *
 * Recomputes every cafe's work_stats from its non-deleted check-ins
 * (spec 0001 §Aggregation). This is the same recomputeWorkStats used by
 * the check-in write paths, run in a tight loop: one transaction per cafe
 * with SELECT ... FOR UPDATE, so concurrent check-in writes serialize.
 *
 * Running it twice with no intervening writes is a no-op: the second run
 * reads the same check-ins and writes the same JSON, so it is idempotent
 * and safe to retry.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/recompute-work-stats.mjs
 *   npm run recompute:work-stats
 *
 * Failures are observable: the process exits non-zero and logs the cafe
 * id + error, so a cron (GitHub Actions schedule, systemd timer, or VPS
 * crontab) can alert. Partial failures do not abort the whole run — each
 * cafe is recomputed independently and errors are aggregated.
 */

import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

/** Mirrors web/lib/db/postgres.ts parse logic for sslmode. */
function parseConnectionConfig(urlString) {
  const url = new URL(urlString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const config = { connectionString: url.toString() };
  if (sslmode !== null) {
    if (sslmode === "disable") config.ssl = false;
    else if (sslmode === "allow-self-signed") config.ssl = { rejectUnauthorized: false };
    else if (
      sslmode === "require" ||
      sslmode === "prefer" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full"
    )
      config.ssl = { rejectUnauthorized: true };
    else throw new Error(`Unrecognized sslmode "${sslmode}" in DATABASE_URL.`);
  }
  return config;
}

/** Lazy import of the TS-compiled aggregate helper is not available in plain mjs,
 *  so this script re-implements the recompute loop in SQL to stay
 *  dependency-free and dogfood the same transaction shape: FOR UPDATE + full
 *  recompute. For the test suite, the canonical TS recomputeAllWorkStats is
 *  still the source of truth (web/lib/stats/aggregate.ts).
 *
 *  To keep the script small and avoid a build step, we invoke the same SQL
 *  the TS code uses: select non-deleted check-ins ordered by visited_at desc,
 *  compute the weighted means in JS, then single-row UPDATE.
 *
 *  The JS weights here mirror web/lib/stats/work-stats.ts exactly:
 *    w_i = 0.6^rank_from_newest, social_weight=0 at launch.
 */

const WORK_DIMS = ["wifi", "outlets", "seats", "temp", "coffee", "overall"];
const COMPOSITE_DIMS = ["wifi", "outlets", "seats", "temp", "coffee"];
const DIM_WEIGHTS = { wifi: 0.3, outlets: 0.2, seats: 0.2, temp: 0.15, coffee: 0.15 };

function emptyWorkStats() {
  const dims = {};
  for (const d of WORK_DIMS) dims[d] = { sum: 0, n: 0 };
  return {
    n_users: 0,
    n_checkins: 0,
    dims,
    policies: { max_stay: {} },
    experience_score: null,
    composite_score: null,
    updated_at: new Date().toISOString(),
  };
}

function computeCompositeScore(stats) {
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

function computeExperienceScore(stats) {
  const { sum, n } = stats.dims.overall;
  return n > 0 ? sum / n : null;
}

function computeUserContribution(checkins) {
  if (checkins.length === 0) return { dims: {}, max_stay: undefined };
  const sorted = [...checkins].sort((a, b) => new Date(b.visited_at) - new Date(a.visited_at));
  const latest = sorted[0];
  const dims = {};
  for (const dim of WORK_DIMS) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < sorted.length; i++) {
      const score = sorted[i].scores?.[dim];
      if (typeof score === "number") {
        const w = Math.pow(0.6, i);
        weightedSum += score * w;
        weightTotal += w;
      }
    }
    dims[dim] = weightTotal > 0 ? weightedSum / weightTotal : undefined;
  }
  return {
    dims,
    max_stay: latest.max_stay ?? undefined,
  };
}

function applyUserContributionDiff(stats, oldC, newC, nCheckins) {
  const next = {
    ...stats,
    dims: { ...stats.dims },
    policies: { max_stay: { ...stats.policies.max_stay } },
  };
  for (const d of WORK_DIMS) next.dims[d] = { ...stats.dims[d] };
  for (const dim of WORK_DIMS) {
    const o = oldC?.dims[dim];
    const n = newC?.dims[dim];
    if (o !== undefined) { next.dims[dim].sum -= o; next.dims[dim].n -= 1; }
    if (n !== undefined) { next.dims[dim].sum += n; next.dims[dim].n += 1; }
  }
  const isPresent = (c) => c && c.dims.overall !== undefined;
  next.n_users += (isPresent(newC) ? 1 : 0) - (isPresent(oldC) ? 1 : 0);
  next.n_checkins = nCheckins;
  const bump = (counts, oldV, newV) => {
    if (oldV !== undefined) { counts[oldV] = (counts[oldV] ?? 0) - 1; if (counts[oldV] === 0) delete counts[oldV]; }
    if (newV !== undefined) counts[newV] = (counts[newV] ?? 0) + 1;
  };
  bump(next.policies.max_stay, oldC?.max_stay, newC?.max_stay);
  next.experience_score = computeExperienceScore(next);
  next.composite_score = computeCompositeScore(next);
  next.updated_at = new Date().toISOString();
  return next;
}

function computeCafeStats(checkins) {
  const byUser = new Map();
  for (const c of checkins) {
    const l = byUser.get(c.user_id) ?? [];
    l.push(c);
    byUser.set(c.user_id, l);
  }
  let stats = emptyWorkStats();
  for (const [, rows] of byUser) {
    const contrib = computeUserContribution(rows);
    stats = applyUserContributionDiff(stats, null, contrib, checkins.length);
  }
  stats.n_checkins = checkins.length;
  stats.n_users = byUser.size;
  return stats;
}

async function recomputeOneCafe(client, cafeId) {
  await client.query("select 1 from cafes where id = $1 for update", [cafeId]);
  const { rows } = await client.query(
    `select id, cafe_id, user_id, is_creation, scores, max_stay, note,
            photos, likes_count, visited_at, created_at, updated_at, deleted_at
     from checkins where cafe_id = $1 and deleted_at is null order by visited_at desc`,
    [cafeId],
  );
  const stats = computeCafeStats(rows);
  await client.query("update cafes set work_stats = $1, updated_at = now() where id = $2", [
    JSON.stringify(stats),
    cafeId,
  ]);
}

async function main() {
  const rawUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const client = new pg.Client(parseConnectionConfig(rawUrl));
  await client.connect();
  try {
    const { rows } = await client.query("select id from cafes order by id");
    console.log(`recompute: ${rows.length} cafe(s)`);
    let ok = 0;
    let failed = 0;
    const errors = [];
    for (const { id } of rows) {
      try {
        await client.query("begin");
        try {
          await recomputeOneCafe(client, id);
          await client.query("commit");
          ok++;
        } catch (e) {
          await client.query("rollback").catch(() => {});
          throw e;
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`recompute failed for cafe ${id}: ${msg}`);
        errors.push({ id, error: msg });
      }
      if ((ok + failed) % 100 === 0) console.log(`progress: ${ok} ok, ${failed} failed`);
    }
    console.log(`done: ${ok} ok, ${failed} failed`);
    if (failed > 0) {
      console.error(JSON.stringify(errors, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  });
}
