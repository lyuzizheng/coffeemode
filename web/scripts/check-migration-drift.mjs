#!/usr/bin/env node
/**
 * Migration-drift check (BRAWUKA-337): compare web/db/migrations/*.sql against
 * a database's schema_migrations ledger and fail (exit 1) on any gap.
 *
 * Read-only: never applies migrations, never touches RLS. The writer is
 * web/scripts/migrate.mjs (via setup-supabase.mjs / upgrade-*.sh).
 *
 * Usage:
 *   node scripts/check-migration-drift.mjs --database-url <url>
 *   DATABASE_URL=<url> node scripts/check-migration-drift.mjs
 *
 * Exit codes: 0 = converged, 1 = drift (or ledger missing), 2 = usage error.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { parsePostgresConnection } from "./lib/postgres-connection.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "..", "db", "migrations");

function usage() {
  console.error("usage: node scripts/check-migration-drift.mjs --database-url <url>");
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.DATABASE_URL?.trim() || "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--database-url") url = args[++i]?.trim() || "";
    else usage();
  }
  if (!url) usage();
  return url;
}

const rawUrl = parseArgs();
const client = new pg.Client(parsePostgresConnection(rawUrl));
await client.connect();
try {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  let applied;
  try {
    const { rows } = await client.query("select name from schema_migrations order by name");
    applied = new Set(rows.map((r) => r.name));
  } catch {
    console.error("DRIFT: schema_migrations ledger missing — database was never migrated.");
    process.exit(1);
  }
  const missing = files.filter((f) => !applied.has(f));
  const extra = [...applied].filter((a) => !files.includes(a));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`converged: ${files.length} repo migration(s) == ledger (${[...applied].at(-1) ?? "empty"} latest)`);
  } else {
    if (missing.length > 0) console.error(`DRIFT: ledger is missing ${missing.length} repo migration(s): ${missing.join(", ")}`);
    if (extra.length > 0) console.error(`DRIFT: ledger has ${extra.length} unknown migration(s): ${extra.join(", ")}`);
    process.exit(1);
  }
} finally {
  await client.end();
}
