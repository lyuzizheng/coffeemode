/**
 * Supabase Postgres provisioning & verification — the database half of the
 * provisioning suite (BRAWUKA-745 decomposition; executable:
 * `scripts/devops/setup-supabase.mjs`).
 *
 * One concrete operation, `provisionSupabaseDatabase`, owns the whole database
 * phase: connect with the fail-closed TLS policy, ensure PostGIS, run the
 * canonical migration runner (`web/scripts/migrate.mjs` — the same module
 * `npm run db:migrate` executes, never a second migration path), verify the
 * migration-derived table inventory and spatial index, enforce PostgREST
 * security, and close the connection in a `finally` so a mid-phase failure
 * never leaks a client. `config.verifyOnly` / `config.dryRun` narrow the
 * operation in place; there is deliberately no phase registry, dependency
 * container, or per-statement module.
 *
 * The operation takes the `pg` module, the resolved config, and the suite's
 * `log` as arguments — this module imports no dependency from the web package,
 * so the executable keeps ownership of resolving `pg` from `web/package.json`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Shared sslmode translation (BRAWUKA-741) — this suite owns only the Supabase
// strict-TLS default applied by `parseConnectionConfig` below.
import { parsePostgresConnection } from "../../../web/scripts/lib/postgres-connection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const WEB_DIR = path.join(REPO_ROOT, "web");
const MIGRATIONS_DIR_ABS = path.join(WEB_DIR, "db", "migrations");

/**
 * Postgres SSL connection string parser (fail-closed per pending-user-actions #41).
 *
 * Provisioning policy over the shared translator (BRAWUKA-741): a Supabase
 * direct host (`db.<ref>.supabase.co` / `.supabase.net`) without an explicit
 * `sslmode` gets strict CA validation — provisioning must never reach a
 * Supabase project in plaintext. Explicit `sslmode` always wins, and every
 * other host (localhost, the Dokploy-network staging database, pooler hosts,
 * whose URLs carry `sslmode=require`) keeps the driver default.
 *
 * @param {string} urlString
 * @returns {{ connectionString: string, ssl?: boolean | { rejectUnauthorized: boolean } }}
 */
export function parseConnectionConfig(urlString) {
  return parsePostgresConnection(urlString, { strictTlsForSupabaseHosts: true });
}

// BRAWUKA-337: single source of truth for "which public tables must exist
// with RLS on". Scans web/db/migrations/*.sql for CREATE TABLE <name> so a
// new table can never again ship without RLS coverage by forgetting a
// hand-maintained list (0021 helpful_ranking_runs/entries did exactly that).
// BRAWUKA-378: also subtracts DROP TABLE <name> — 0026 is the repo's first
// table drop, and without the subtraction the verifier expects a table the
// migrated database correctly no longer has. Drops are collected across all
// files and subtracted at the end, so a drop wins over an earlier create.
// Tables born from CREATE TABLE AS / SELECT INTO would be missed by this
// regex; migrations MUST use plain CREATE TABLE (the repo has zero CTAS
// today — grep SELECT.INTO web/db/migrations to confirm) so the scan stays
// complete. schema_migrations is runner bookkeeping, also RLS-covered.
export function listMigrationTables() {
  const tables = new Set(["schema_migrations"]);
  let files = [];
  try {
    files = readdirSync(MIGRATIONS_DIR_ABS).filter((f) => f.endsWith(".sql"));
  } catch {
    throw new Error(
      `Integrity Error: migrations dir unreadable at ${MIGRATIONS_DIR_ABS}; refusing to verify RLS against an unknown table set.`,
    );
  }
  if (files.length === 0) {
    throw new Error(
      `Integrity Error: no *.sql files in ${MIGRATIONS_DIR_ABS}; refusing to verify RLS against an empty table set.`,
    );
  }
  const createTableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
  const dropTableRe = /drop\s+table\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
  const dropped = new Set();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR_ABS, file), "utf8");
    createTableRe.lastIndex = 0;
    let m;
    while ((m = createTableRe.exec(sql)) !== null) {
      const schema = m[1] ? m[1].toLowerCase() : "public";
      const table = m[2].toLowerCase();
      if (schema === "public") tables.add(table);
    }
    dropTableRe.lastIndex = 0;
    while ((m = dropTableRe.exec(sql)) !== null) {
      const schema = m[1] ? m[1].toLowerCase() : "public";
      if (schema === "public") dropped.add(m[2].toLowerCase());
    }
  }
  for (const table of dropped) tables.delete(table);
  return [...tables].sort();
}

/**
 * Steps 2–5 of the suite: connect, PostGIS, migrations, inventory + spatial
 * index, PostgREST/RLS defense. Call only when `config.databaseUrl` is set —
 * "no database configured" is the executable's orchestration decision.
 *
 * @param {{ pg: { Client: new (config: object) => object }, config: object, log: { info: Function, step: Function, success: Function, warn: Function, error: Function, dim: Function } }} deps
 * @returns {Promise<void>}
 */
export async function provisionSupabaseDatabase({ pg, config, log }) {
  log.step(2, "Connecting to Supabase Database & PostGIS Check");
  const connConfig = parseConnectionConfig(config.databaseUrl);
  const client = new pg.Client(connConfig);

  try {
    await client.connect();
    log.success("Connected to PostgreSQL database successfully.");

    const verRes = await client.query("SELECT version();");
    log.dim(verRes.rows[0].version);

    // PostGIS spatial extension verification & self-healing
    log.info("Checking PostGIS spatial extension status...");
    const extRes = await client.query(`
      SELECT default_version, installed_version 
      FROM pg_available_extensions 
      WHERE name = 'postgis';
    `);

    const postgisExt = extRes.rows[0];
    if (!postgisExt) {
      throw new Error("PostGIS extension is not available in this PostgreSQL instance catalog.");
    }

    if (postgisExt.installed_version) {
      log.success(`PostGIS extension is active (v${postgisExt.installed_version}).`);
      const postgisVerRes = await client.query("SELECT postgis_full_version();");
      log.dim(`PostGIS Build: ${postgisVerRes.rows[0].postgis_full_version.split("\n")[0]}`);
    } else {
      log.warn("PostGIS extension is not enabled. Attempting self-healing installation...");
      if (config.dryRun || config.verifyOnly) {
        log.dim("[DRY RUN / VERIFY ONLY] Would execute: CREATE EXTENSION IF NOT EXISTS postgis;");
      } else {
        await client.query("CREATE EXTENSION IF NOT EXISTS postgis;");
        log.success("CREATE EXTENSION IF NOT EXISTS postgis executed successfully.");
        const postgisVerRes = await client.query("SELECT postgis_full_version();");
        log.dim(`PostGIS Build: ${postgisVerRes.rows[0].postgis_full_version.split("\n")[0]}`);
      }
    }
    // ------------------------------------------------------------------------
    // Step 3: Database Migrations
    // ------------------------------------------------------------------------
    log.step(3, "Applying Database Migrations");
    const migrateScriptPath = path.join(WEB_DIR, "scripts", "migrate.mjs");
    const migrateMod = await import(pathToFileURL(migrateScriptPath).href);

    if (config.verifyOnly) {
      log.info("Verifying applied migrations in schema_migrations...");
      const smCheck = await client.query(`
        SELECT count(*)::int as count FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'schema_migrations';
      `);
      if (smCheck.rows[0].count === 0) {
        log.error("schema_migrations table does not exist!");
      } else {
        const appliedRows = await client.query("SELECT name, applied_at FROM schema_migrations ORDER BY name;");
        log.success(`schema_migrations contains ${appliedRows.rows.length} applied migration(s).`);
        for (const row of appliedRows.rows) {
          log.dim(`- ${row.name} (applied ${new Date(row.applied_at).toISOString()})`);
        }
      }
    } else if (config.dryRun) {
      log.info("[DRY RUN] Would execute applyMigrations(client) via web/scripts/migrate.mjs");
    } else {
      log.info("Executing idempotent migration runner (web/scripts/migrate.mjs)...");
      const count = await migrateMod.applyMigrations(client);
      log.success(count === 0 ? "Database is up to date: 0 pending migrations." : `Applied ${count} new migration(s) successfully.`);
    }

    // ------------------------------------------------------------------------
    // Step 4: Core Tables & Spatial Index Integrity Verification
    // ------------------------------------------------------------------------
    // BRAWUKA-337: expectedTables is DERIVED from web/db/migrations/*.sql
    // (create-table scan), never a second hand-written inventory. A new
    // CREATE TABLE without RLS coverage fails closed here instead of
    // shipping RLS-dark (0021 helpful_ranking_* shipped exactly that way).
    log.step(4, "Verifying Core Tables & Spatial Index Integrity");
    const expectedTables = listMigrationTables();

    const tablesQuery = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);
    const existingTables = new Set(tablesQuery.rows.map((r) => r.table_name));

    for (const t of expectedTables) {
      if (existingTables.has(t)) {
        log.success(`Table 'public.${t}' exists.`);
      } else if (config.dryRun) {
        log.warn(`[DRY RUN] Table 'public.${t}' is not present yet (would be created by migrations).`);
      } else {
        throw new Error(`Integrity Error: Table 'public.${t}' is missing from database.`);
      }
    }

    // Check GiST index on cafes (location)
    if (existingTables.has("cafes")) {
      const indexRes = await client.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'cafes' AND indexname = 'idx_cafes_location_active';
      `);

      if (indexRes.rows.length > 0) {
        log.success("Spatial GiST index 'idx_cafes_location_active' exists on cafes.");
        log.dim(`Index Definition: ${indexRes.rows[0].indexdef}`);
      } else if (config.dryRun) {
        log.warn("[DRY RUN] Spatial GiST index 'idx_cafes_location_active' is not present yet (would be created by migrations).");
      } else {
        throw new Error("Integrity Error: Spatial GiST index 'idx_cafes_location_active' is missing on cafes.");
      }
    } else if (config.dryRun) {
      log.warn("[DRY RUN] Table 'cafes' not present; skipping spatial GiST index check.");
    }

    // Check seed service-account profile
    if (existingTables.has("profiles")) {
      const serviceProfileRes = await client.query(`
        SELECT id, display_name 
        FROM profiles 
        WHERE id = '00000000-0000-4000-a000-000000000001';
      `);
      if (serviceProfileRes.rows.length > 0) {
        log.success(`Seed service-account profile verified: ${serviceProfileRes.rows[0].display_name} (${serviceProfileRes.rows[0].id})`);
      } else if (config.dryRun) {
        log.warn("[DRY RUN] Seed service-account '00000000-0000-4000-a000-000000000001' not present yet (would be inserted by migration 0016).");
      } else {
        log.warn("Seed service-account '00000000-0000-4000-a000-000000000001' is not present in profiles table.");
      }
    } else if (config.dryRun) {
      log.warn("[DRY RUN] Table 'profiles' not present; skipping seed service-account check.");
    }
    // ------------------------------------------------------------------------
    // Step 5: PostgREST Security Defense (Spec 0001 §Data Layer)
    // ------------------------------------------------------------------------
    log.step(5, "Enforcing PostgREST Security & Data Layer Defense");
    log.info("Spec 0001 Invariant: Data is server-mediated; anon/authenticated PostgREST access must be blocked.");

    if (config.dryRun || config.verifyOnly) {
      log.info("[DRY RUN / VERIFY ONLY] Checking RLS status across public tables...");
      const rlsQuery = await client.query(`
        SELECT relname as table_name, relrowsecurity as rls_enabled
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = 'public' AND pg_class.relkind = 'r'
          AND relname = ANY($1);
      `, [expectedTables]);
      const seen = new Set(rlsQuery.rows.map((r) => r.table_name));
      // BRAWUKA-337 fail-closed: expected-but-absent tables and RLS-off
      // tables FAIL verify/dry-run (exit 1) instead of warn-and-pass.
      // Tables below drifted before this check existed; the next STAGING
      // then PROD provision converges them (verify-only may still fail
      // until then — that failure IS the drift signal).
      const failures = expectedTables.filter((t) => !seen.has(t));
      for (const row of rlsQuery.rows) {
        if (row.rls_enabled) {
          log.success(`RLS enabled on '${row.table_name}'.`);
        } else {
          failures.push(row.table_name);
          log.error(`RLS is DISABLED on '${row.table_name}'.`);
        }
      }
      for (const t of expectedTables.filter((t) => !seen.has(t))) {
        log.error(`Table 'public.${t}' expected by migrations but absent from database.`);
      }
      if (failures.length > 0) {
        throw new Error(
          `Integrity Error: RLS coverage incomplete (${failures.length}): ${failures.join(", ")}.`,
        );
      }
    } else {
      log.info("Enabling Row Level Security (RLS) on all application tables...");
      for (const t of expectedTables) {
        await client.query(`ALTER TABLE "public"."${t}" ENABLE ROW LEVEL SECURITY;`);
      }
      log.success("RLS enabled on all application tables.");

      log.info("Checking for anon and authenticated roles in database...");
      const rolesRes = await client.query(`
        SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
      `);
      const existingRoles = new Set(rolesRes.rows.map((r) => r.rolname));
      const targetRoles = ["anon", "authenticated"].filter((r) => existingRoles.has(r));

      if (targetRoles.length > 0) {
        const roleList = targetRoles.join(", ");
        log.info(`Revoking default grants from ${roleList}...`);
        await client.query(`
          REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${roleList};
          REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${roleList};
          REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM ${roleList};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${roleList};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${roleList};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM ${roleList};
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM ${roleList};
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${roleList};
          ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM ${roleList};
        `);
        log.success(`Privileges revoked from ${roleList}.`);
      } else {
        log.info("Note: Neither 'anon' nor 'authenticated' roles exist in this instance (non-Supabase catalog).");
      }

      // BRAWUKA-337: self-verify on the same connection — the provision that
      // just enabled RLS must also prove it (fail-closed, not log-and-hope).
      // Catches a mid-list failure (e.g. ALTER on a dropped table) that
      // would otherwise exit 0 with half the tables RLS-dark.
      const verifyRes = await client.query(`
        SELECT relname as table_name
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = 'public' AND pg_class.relkind = 'r'
          AND relname = ANY($1) AND NOT relrowsecurity;
      `, [expectedTables]);
      if (verifyRes.rows.length > 0) {
        const dark = verifyRes.rows.map((r) => r.table_name).join(", ");
        throw new Error(`Integrity Error: RLS still disabled after provision on: ${dark}.`);
      }
      log.success("Post-provision RLS self-verification passed on all expected tables.");
    }

    // Verify that anon role cannot read cafes (if role and table exist)
    const anonRoleCheck = await client.query(`
      SELECT 1 FROM pg_roles WHERE rolname = 'anon';
    `);
    if (anonRoleCheck.rows.length > 0) {
      if (existingTables.has("cafes")) {
        log.info("Verifying permission denial for anon role...");
        try {
          await client.query(`
            DO $$
            BEGIN
              SET LOCAL ROLE anon;
              BEGIN
                PERFORM count(*) FROM cafes;
                RAISE EXCEPTION 'CRITICAL: anon role was able to read cafes table!';
              EXCEPTION WHEN insufficient_privilege THEN
                -- Expected behavior
              END;
            END $$;
          `);
          log.success("Permission denial verified: anon role is strictly blocked from data tables.");
        } catch (err) {
          log.error(`Security check failed: ${err.message}`);
          throw err;
        }
      } else if (config.dryRun) {
        log.warn("[DRY RUN] Table 'cafes' not present; skipping anon role query simulation.");
      }
    } else {
      log.info("Skipping anon role permission denial test ('anon' role not present in database).");
    }
  } finally {
    await client.end();
    log.info("Closed database connection.");
  }
}
