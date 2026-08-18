#!/usr/bin/env node
/**
 * CoffeeMode migration runner — applies web/db/migrations/*.sql in order
 * against a Postgres database, tracking applied files in schema_migrations.
 *
 * This closes the "SQL validated by reasoning only" gap: every migration
 * (0001 init … 0008 no-self-likes trigger) is exercised against a real
 * Postgres/PostGIS before code that depends on it ships.
 *
 * Usage:
 *   npm run db:migrate                       # dev DB (docker-compose defaults)
 *   DATABASE_URL=postgres://... npm run db:migrate
 *
 * Exports applyMigrations(client) so the integration suite
 * (tests/integration/db.integration.test.ts) can reuse the same loop.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations",
);

/** Local dev default — matches docker-compose.yml (postgis/postgis). */
const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

const MIGRATION_LOCK_KEY_SQL = "hashtext('coffeemode_migrations')";

/**
 * Parse sslmode from a Postgres connection string and return a pg.Client
 * config with the mode removed from the URL. Mirrors web/lib/db/postgres.ts
 * so the CLI honors the same sslmode vocabulary as the app pool.
 */
function parseConnectionConfig(urlString) {
  const url = new URL(urlString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");

  const config = { connectionString: url.toString() };

  if (sslmode !== null) {
    if (sslmode === "disable") {
      config.ssl = false;
    } else if (sslmode === "allow-self-signed") {
      config.ssl = { rejectUnauthorized: false };
    } else if (
      sslmode === "require" ||
      sslmode === "prefer" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full"
    ) {
      config.ssl = { rejectUnauthorized: true };
    } else {
      throw new Error(
        `Unrecognized sslmode "${sslmode}" in DATABASE_URL. Use require, prefer, verify-ca, verify-full, allow-self-signed, or disable.`,
      );
    }
  }

  return config;
}

function numericPrefix(name) {
  const match = name.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : Infinity;
}

function migrationOrder(a, b) {
  const na = numericPrefix(a);
  const nb = numericPrefix(b);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

function isNoTransactionMigration(sql) {
  return /^\s*--\s*migrate:\s*no-transaction\b/m.test(sql);
}

/**
 * Apply every migration not yet recorded in schema_migrations, in numeric
 * filename order (0001_init.sql, 0002_…, …). Each migration runs inside its
 * own transaction unless the file starts with `-- migrate: no-transaction`.
 * Returns the number of migrations applied.
 */
export async function applyMigrations(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  await client.query(`select pg_advisory_lock(${MIGRATION_LOCK_KEY_SQL})`);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort(migrationOrder);

  const { rows } = await client.query("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  try {
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const noTransaction = isNoTransactionMigration(sql);

      if (noTransaction) {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        console.log(`applied ${file} (no transaction)`);
        count += 1;
      } else {
        await client.query("begin");
        try {
          await client.query(sql);
          await client.query("insert into schema_migrations (name) values ($1)", [file]);
          await client.query("commit");
          console.log(`applied ${file}`);
          count += 1;
        } catch (err) {
          await client.query("rollback").catch(() => {});
          throw new Error(
            `migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } finally {
    await client.query(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY_SQL})`).catch(() => {});
  }
  return count;
}

/** CLI entry: apply pending migrations and report. */
async function main() {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const client = new pg.Client(parseConnectionConfig(rawDatabaseUrl));
  await client.connect();
  try {
    const count = await applyMigrations(client);
    console.log(count === 0 ? "no pending migrations" : `${count} migration(s) applied`);
  } finally {
    await client.end();
  }
}

// Run as CLI when executed directly (import.meta.main is not stable yet).
// argv[1] may be relative ("scripts/migrate.mjs") when npm runs us.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
