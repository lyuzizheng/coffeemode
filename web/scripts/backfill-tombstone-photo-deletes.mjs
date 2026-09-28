#!/usr/bin/env node
/**
 * One-shot tombstone backfill (BRAWUKA-699): delete R2 variants for photos
 * referenced ONLY by soft-deleted check-ins.
 *
 * Context: PR #694 (BRAWUKA-433) gates every delete path on
 * `selectLivePhotoReferences`, but tombstones created BEFORE that PR never
 * ran the leg — and the #158 sweeper only lists `original/` keys while the
 * live-keys export (then tombstone-unioned) re-protected them. This script
 * converges that residue: for every tombstoned check-in photo id no LIVE
 * row names, DELETE the three derived keys through the image-service
 * `/v1/images/delete` endpoint (never direct R2 — the endpoint owns key
 * derivation and stays the only deleter).
 *
 * Safety properties (mirror the delete paths + sweeper):
 *   - Live-only gate: an id still named by a live `cafes.gallery` /
 *     live `checkins.photos` row is skipped, never deleted. Shared photos
 *     survive exactly like the post-commit leg.
 *   - Read-only DB by default: DRY_RUN=1 (default) reports would-delete /
 *     would-keep without calling the endpoint.
 *   - Bounded batches (BATCH_SIZE, default 25): one endpoint POST per id.
 *   - Endpoint deletes are 404-tolerant (missing = already gone); a failed
 *     id is reported per id and retried on the next run (exit code 1 when
 *     DRY_RUN=0 and any id failed).
 *   - Empty tombstone set exits 0 with `tombstones: 0`.
 *
 * Required env:
 *   DATABASE_URL          — least-privilege reader is enough (SELECT only).
 *   IMAGE_SERVICE_URL     — e.g. https://image-service.cafemood.app
 *   IMAGE_SERVICE_TOKEN   — service token for /v1/images/delete
 * Optional env:
 *   DRY_RUN=1 (default) | 0 — set 0 to actually delete.
 *   BATCH_SIZE (default 25, max 100) — endpoint POSTs per batch window.
 *   MAX_IDS (default 1000) — cap tombstone ids evaluated per run.
 *
 * Usage:
 *   DATABASE_URL=... IMAGE_SERVICE_URL=... IMAGE_SERVICE_TOKEN=... \
 *     node web/scripts/backfill-tombstone-photo-deletes.mjs
 *   # review, then:
 *   ... DRY_RUN=0 node web/scripts/backfill-tombstone-photo-deletes.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { randomUUID } from "node:crypto";

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL?.replace(/\/+$/, "");
const IMAGE_SERVICE_TOKEN = process.env.IMAGE_SERVICE_TOKEN;
const DRY_RUN = process.env.DRY_RUN !== "0";
const BATCH_SIZE = Math.min(Number.parseInt(process.env.BATCH_SIZE ?? "25", 10), 100);
const MAX_IDS = Number.parseInt(process.env.MAX_IDS ?? "1000", 10);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Mirrors web/lib/db/postgres.ts + web/scripts/migrate.mjs sslmode handling. */
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

/**
 * Tombstone-only photo ids (BRAWUKA-699): ids on soft-deleted check-ins
 * minus ids any LIVE row still names. Mirrors `selectLivePhotoReferences`
 * (live cafes + live check-ins) so the backfill and the delete paths agree
 * on what "live" means; differs only in that it enumerates tombstone ids
 * instead of gating caller-supplied ones. Ordered by id so repeated runs
 * with MAX_IDS page deterministically and the tail converges.
 */
const TOMBSTONE_IDS_SQL = `
select distinct elem->>'id' as id
from checkins c, jsonb_array_elements(coalesce(c.photos, '[]'::jsonb)) elem
where c.deleted_at is not null
  and elem->>'id' ~ '^[0-9a-f-]{36}$'
  and not exists (
    select 1 from cafes k, jsonb_array_elements(coalesce(k.gallery, '[]'::jsonb)) g
    where k.deleted_at is null and g->>'id' = elem->>'id'
  )
  and not exists (
    select 1 from checkins live, jsonb_array_elements(coalesce(live.photos, '[]'::jsonb)) p
    where live.deleted_at is null and p->>'id' = elem->>'id'
  )
order by elem->>'id'
limit $1
`;

export async function collectTombstoneOnlyPhotoIds(client, limit = MAX_IDS) {
  const { rows } = await client.query(TOMBSTONE_IDS_SQL, [limit]);
  const ids = new Set();
  for (const row of rows) {
    if (typeof row.id === "string" && UUID_RE.test(row.id)) ids.add(row.id.toLowerCase());
  }
  return [...ids].sort();
}

function validateConfig() {
  if (!IMAGE_SERVICE_URL || !IMAGE_SERVICE_TOKEN) {
    console.error(
      "backfill-tombstone-photo-deletes: IMAGE_SERVICE_URL and IMAGE_SERVICE_TOKEN are required",
    );
    process.exit(1);
  }
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) {
    console.error("backfill-tombstone-photo-deletes: BATCH_SIZE must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(MAX_IDS) || MAX_IDS < 1) {
    console.error("backfill-tombstone-photo-deletes: MAX_IDS must be a positive integer");
    process.exit(1);
  }
}

async function deleteOne(imageUuid) {
  const requestId = randomUUID();
  let res;
  try {
    res = await fetch(`${IMAGE_SERVICE_URL}/v1/images/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-image-service-token": IMAGE_SERVICE_TOKEN,
        "x-request-id": requestId,
      },
      body: JSON.stringify({ imageUuid }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { imageUuid, error: e instanceof Error ? e.message : String(e) };
  }
  // Benign: drain the small JSON body; ok vs. error is decided below on
  // `res.ok` alone (the caller reports per-id failures for the next run).
  await res.body?.cancel().catch(() => {});
  if (res.ok) return null;
  return { imageUuid, status: res.status };
}

async function main() {
  validateConfig();
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const client = new pg.Client(parseConnectionConfig(rawDatabaseUrl));
  await client.connect();
  let ids;
  try {
    ids = await collectTombstoneOnlyPhotoIds(client);
  } finally {
    await client.end();
  }
  console.log(JSON.stringify({ op: "start", dryRun: DRY_RUN, tombstones: ids.length }));
  if (ids.length === 0) {
    console.log(JSON.stringify({ op: "done", deleted: 0 }));
    return;
  }
  if (DRY_RUN) {
    for (const id of ids) console.log(JSON.stringify({ op: "would-delete", imageUuid: id }));
    console.log(JSON.stringify({ op: "done", deleted: 0, wouldDelete: ids.length, dryRun: true }));
    return;
  }
  const deleted = [];
  const failed = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map((id) => deleteOne(id)));
    let batchDeleted = 0;
    for (let j = 0; j < batch.length; j += 1) {
      const outcome = outcomes[j];
      if (outcome) failed.push(outcome);
      else {
        deleted.push(batch[j]);
        batchDeleted += 1;
      }
    }
    console.log(
      JSON.stringify({
        op: "delete",
        batch: Math.floor(i / BATCH_SIZE) + 1,
        requested: batch.length,
        deleted: batchDeleted,
        failed: failed.length,
      }),
    );
  }
  console.log(JSON.stringify({ op: "done", deleted: deleted.length, failed: failed.length }));
  if (failed.length > 0) process.exitCode = 1;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(
      "backfill-tombstone-photo-deletes failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
