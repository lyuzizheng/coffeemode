#!/usr/bin/env node
/**
 * CafeMood Helpful ranking nightly snapshot (DG148, #140).
 *
 * Builds one global ranking run per execution: inserts a `building` run,
 * fills `helpful_ranking_entries` with ONE `INSERT ... SELECT` computing
 * `score = likes_count * 0.5^(age_days / halfLifeDays)` over non-deleted
 * check-ins (age from `visited_at`; zero-like rows score 0), then publishes
 * atomically — supersede the old active run + activate the new one in ONE
 * transaction — and deletes superseded runs older than
 * `snapshotRetentionDays` (entries cascade).
 *
 * Idempotent: a re-run just builds and publishes a newer run; an
 * interrupted run stays `building`, is never served, and is cleaned up once
 * older than the retention window — the previous active version keeps
 * serving on failure.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/snapshot-helpful-ranking.mjs
 *   npm run snapshot:helpful-ranking
 *
 * Failures are observable: each step logs and the process exits non-zero,
 * so the nightly workflow alerts (same convention as recompute-work-stats).
 */

import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appYamlPath = path.resolve(__dirname, "../config/app.yaml");

let HALF_LIFE_DAYS = 14;
let SNAPSHOT_RETENTION_DAYS = 7;

try {
  const yamlContent = readFileSync(appYamlPath, "utf8");
  const parsed = parse(yamlContent);
  if (typeof parsed?.feed?.helpful?.halfLifeDays === "number") {
    HALF_LIFE_DAYS = parsed.feed.helpful.halfLifeDays;
  }
  if (typeof parsed?.feed?.helpful?.snapshotRetentionDays === "number") {
    SNAPSHOT_RETENTION_DAYS = parsed.feed.helpful.snapshotRetentionDays;
  }
} catch {
  // Use fallback defaults if config is unreadable
}

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

async function main() {
  const rawUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const client = new pg.Client(parseConnectionConfig(rawUrl));
  await client.connect();
  try {
    // Step 1: open a building run.
    const runRes = await client.query(
      "insert into helpful_ranking_runs (status) values ('building') returning id",
    );
    const runId = runRes.rows[0].id;
    console.log(`snapshot: building run ${runId}`);

    // Step 2: freeze one entry per live check-in with its decayed score.
    const fillRes = await client.query(
      `insert into helpful_ranking_entries
         (run_id, cafe_id, checkin_id, score, likes_count, visited_at)
       select $1, c.cafe_id, c.id,
              c.likes_count
                * power(0.5, extract(epoch from (now() - c.visited_at)) / 86400.0 / $2),
              c.likes_count, c.visited_at
       from checkins c
       where c.deleted_at is null`,
      [runId, HALF_LIFE_DAYS],
    );
    console.log(`snapshot: froze ${fillRes.rowCount} entr${fillRes.rowCount === 1 ? "y" : "ies"}`);

    // Step 3: publish atomically — the previous active version keeps serving
    // until this transaction commits, so a failure here changes nothing
    // visible. Stale building runs (interrupted executions) are never
    // served; both they and old superseded runs past the retention window
    // are deleted here (entries cascade).
    await client.query("begin");
    try {
      await client.query(
        "update helpful_ranking_runs set status = 'superseded' where status = 'active'",
      );
      const activateRes = await client.query(
        "update helpful_ranking_runs set status = 'active', activated_at = now() where id = $1",
        [runId],
      );
      if (activateRes.rowCount !== 1) {
        throw new Error(`activate affected ${activateRes.rowCount} rows, expected 1`);
      }
      const gcRes = await client.query(
        `delete from helpful_ranking_runs
         where status in ('superseded', 'building')
           and id <> $1
           and built_at < now() - ($2 || ' days')::interval`,
        [runId, String(SNAPSHOT_RETENTION_DAYS)],
      );
      await client.query("commit");
      console.log(`snapshot: published run ${runId}, reclaimed ${gcRes.rowCount} old run(s)`);
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
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
