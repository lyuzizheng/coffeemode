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
const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

/**
 * Apply every migration not yet recorded in schema_migrations, in filename
 * order (0001_init.sql, 0002_…, …), each inside its own transaction.
 * Returns the number of migrations applied.
 */
export async function applyMigrations(client) {
  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await client.query("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

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
  return count;
}

/** CLI entry: apply pending migrations and report. */
async function main() {
  const client = new pg.Client({ connectionString: DEFAULT_DATABASE_URL });
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
