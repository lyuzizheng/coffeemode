#!/usr/bin/env node
/**
 * ==============================================================================
 * CoffeeMode Supabase Production Setup & Verification Suite
 * Architecture: docs/specs/0001-nextjs-migration.md §Data layer
 * Product Decisions: docs/specs/0004-product-decisions-and-backlog.md (34a & 35)
 *
 * Orchestrates idempotent Supabase main Postgres & Auth provisioning:
 *   1. Validates environment variables & credentials (DATABASE_URL, SUPABASE_URL, keys)
 *   2. Connects to Supabase Postgres with fail-closed SSL enforcement
 *   3. Checks & enables PostGIS spatial extension (self-healing)
 *   4. Runs full database migrations (0001–0019+) via project migration runner
 *   5. Verifies core business tables (cafes, checkins, profiles) & GiST spatial index
 *   6. Enforces PostgREST security defense: enables RLS & revokes anon/authenticated grants
 *   7. Verifies Supabase Auth endpoints, session handling, and OAuth redirect flow
 *
 * Usage:
 *   node scripts/devops/setup-supabase.mjs [options]
 *
 * Options:
 *   -h, --help                Show this help message and exit
 *   --database-url <url>      Direct / pooled PostgreSQL connection string
 *   --supabase-url <url>      Supabase Project API URL (https://<ref>.supabase.co)
 *   --service-role-key <key>  Supabase service_role secret key
 *   --anon-key <key>          Supabase anon public key
 *   --env-file <path>         Path to custom .env file to load
 *   --dry-run                 Log planned actions without modifying state
 *   --verify-only             Skip DDL/mutations and only verify current state
 *   --skip-auth               Skip Supabase Auth connectivity tests
 *   --verbose                 Enable detailed logging
 * ==============================================================================
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ------------------------------------------------------------------------------
// Path & Module Resolution
// ------------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const WEB_DIR = path.join(REPO_ROOT, "web");
const WEB_PKG = path.join(WEB_DIR, "package.json");

const req = createRequire(WEB_PKG);
const pg = req("pg");
const { createClient } = req("@supabase/supabase-js");

// ------------------------------------------------------------------------------
// Formatting & Colors
// ------------------------------------------------------------------------------
const isTTY = Boolean(process.stdout.isTTY);
const color = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  red: isTTY ? "\x1b[31m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  gray: isTTY ? "\x1b[90m" : "",
};

const log = {
  info: (msg) => console.log(`${color.cyan}[INFO]${color.reset} ${msg}`),
  step: (num, title) => console.log(`\n${color.bold}${color.cyan}[Step ${num}]${color.reset} ${color.bold}${title}${color.reset}`),
  success: (msg) => console.log(`${color.green}[PASS]${color.reset} ${msg}`),
  warn: (msg) => console.log(`${color.yellow}[WARN]${color.reset} ${msg}`),
  error: (msg) => console.error(`${color.red}[FAIL]${color.reset} ${msg}`),
  dim: (msg) => console.log(`${color.gray}       ${msg}${color.reset}`),
};

// ------------------------------------------------------------------------------
// CLI Options & Env Parsing
// ------------------------------------------------------------------------------
function showHelp() {
  console.log(`
CoffeeMode Supabase Provisioning & Verification Suite

Usage:
  node scripts/devops/setup-supabase.mjs [options]
  ./scripts/devops/provision-supabase.sh [options]

Options:
  -h, --help                Show this help message and exit
  --database-url <url>      PostgreSQL connection string (supports direct & pooler URLs)
  --supabase-url <url>      Supabase API URL (https://<project-ref>.supabase.co)
  --service-role-key <key>  Supabase service_role secret key
  --anon-key <key>          Supabase anon public key
  --env-file <path>         Path to custom env file to load (default checks .env, web/.env.local)
  --dry-run                 Log planned actions without modifying system state
  --verify-only             Run verification checks only (no DDL migrations or revocations)
  --skip-auth               Skip Supabase Auth endpoint & OAuth smoke test
  --verbose                 Show detailed database and network logs

Environment Variables (fallback):
  DATABASE_URL / SUPABASE_DATABASE_URL / POSTGRES_URL
  SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
`);
  process.exit(0);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    databaseUrl: "",
    supabaseUrl: "",
    serviceRoleKey: "",
    anonKey: "",
    envFile: "",
    dryRun: false,
    verifyOnly: false,
    skipAuth: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        showHelp();
        break;
      case "--database-url":
        options.databaseUrl = args[++i];
        break;
      case "--supabase-url":
        options.supabaseUrl = args[++i];
        break;
      case "--service-role-key":
        options.serviceRoleKey = args[++i];
        break;
      case "--anon-key":
        options.anonKey = args[++i];
        break;
      case "--env-file":
        options.envFile = args[++i];
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verify-only":
        options.verifyOnly = true;
        break;
      case "--skip-auth":
        options.skipAuth = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  // Load from candidate env files if not set
  const candidateFiles = options.envFile
    ? [options.envFile]
    : [
        path.join(REPO_ROOT, ".env"),
        path.join(WEB_DIR, ".env.local"),
        path.join(WEB_DIR, ".env"),
      ];

  const loadedEnv = {};
  for (const file of candidateFiles) {
    if (existsSync(file)) {
      Object.assign(loadedEnv, parseEnvFile(file));
    }
  }

  const getVal = (cliVal, envKeys) => {
    if (cliVal && cliVal.trim()) return cliVal.trim();
    for (const k of envKeys) {
      if (process.env[k]?.trim()) return process.env[k].trim();
      if (loadedEnv[k]?.trim()) return loadedEnv[k].trim();
    }
    return "";
  };

  return {
    databaseUrl: getVal(options.databaseUrl, [
      "DATABASE_URL",
      "SUPABASE_DATABASE_URL",
      "POSTGRES_URL",
    ]),
    supabaseUrl: getVal(options.supabaseUrl, [
      "SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]),
    serviceRoleKey: getVal(options.serviceRoleKey, [
      "SUPABASE_SERVICE_ROLE_KEY",
    ]),
    anonKey: getVal(options.anonKey, [
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]),
    dryRun: options.dryRun,
    verifyOnly: options.verifyOnly,
    skipAuth: options.skipAuth,
    verbose: options.verbose,
  };
}

// ------------------------------------------------------------------------------
// Helper: Postgres SSL connection string parser (fail-closed per pending-user-actions #41)
// ------------------------------------------------------------------------------
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
        `Unrecognized sslmode "${sslmode}" in DATABASE_URL. Use require, prefer, verify-ca, verify-full, allow-self-signed, or disable.`
      );
    }
  } else {
    // Fail-closed default: Supabase hosts use trusted public CA certificates; enforce strict TLS verification.
    if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.net")) {
      config.ssl = { rejectUnauthorized: true };
    }
  }

  return config;
}
function maskString(str, visibleChars = 8) {
  if (!str) return "<none>";
  if (str.length <= visibleChars) return "***";
  return `${str.slice(0, visibleChars)}...${str.slice(-4)}`;
}

// ------------------------------------------------------------------------------
// Main Orchestration Flow
// ------------------------------------------------------------------------------
async function main() {
  console.log(`${color.bold}==============================================================${color.reset}`);
  console.log(`${color.bold}  CoffeeMode Supabase Provisioning & Verification Suite       ${color.reset}`);
  console.log(`${color.bold}==============================================================${color.reset}`);

  const config = parseCliArgs();

  // ----------------------------------------------------------------------------
  // Step 1: Validate Environment & Credentials
  // ----------------------------------------------------------------------------
  log.step(1, "Validating Environment & Credentials");
  log.info(`Target Mode: ${config.verifyOnly ? "VERIFY ONLY" : config.dryRun ? "DRY RUN" : "PROVISION & MIGRATE"}`);

  if (config.databaseUrl) {
    try {
      const parsed = new URL(config.databaseUrl);
      log.success(`Database URL configured: ${parsed.protocol}//${parsed.username}:****@${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`);
    } catch {
      log.error("DATABASE_URL is not a valid URL format");
      process.exit(1);
    }
  } else {
    log.warn("DATABASE_URL is not set. Direct database operations and migrations will be skipped.");
    log.dim("Pass via --database-url or export DATABASE_URL='postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require'");
  }

  if (config.supabaseUrl) {
    try {
      const parsed = new URL(config.supabaseUrl);
      log.success(`Supabase Project URL: ${parsed.origin}`);
    } catch {
      log.error("SUPABASE_URL is not a valid URL format");
      process.exit(1);
    }
  } else {
    log.warn("SUPABASE_URL is not set. Auth verification will be skipped.");
    log.dim("Pass via --supabase-url or export SUPABASE_URL='https://[project-ref].supabase.co'");
  }

  if (config.serviceRoleKey) {
    log.success(`Service Role Key: present (${maskString(config.serviceRoleKey)})`);
  } else {
    log.dim("Service Role Key: not provided (optional for auth smoke check)");
  }

  if (config.anonKey) {
    log.success(`Anon Public Key: present (${maskString(config.anonKey)})`);
  } else {
    log.dim("Anon Public Key: not provided (optional for auth smoke check)");
  }

  // ----------------------------------------------------------------------------
  // Database Operations (Steps 2 to 5)
  // ----------------------------------------------------------------------------
  let client = null;
  if (config.databaseUrl) {
    log.step(2, "Connecting to Supabase Database & PostGIS Check");
    const connConfig = parseConnectionConfig(config.databaseUrl);
    client = new pg.Client(connConfig);

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
      log.step(4, "Verifying Core Tables & Spatial Index Integrity");
      const expectedTables = [
        "profiles",
        "cafes",
        "checkins",
        "checkin_likes",
        "navigations",
        "rate_limits",
        "image_upload_intents",
        "schema_migrations",
      ];

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

        for (const row of rlsQuery.rows) {
          if (row.rls_enabled) {
            log.success(`RLS enabled on '${row.table_name}'.`);
          } else {
            log.warn(`RLS is disabled on '${row.table_name}'.`);
          }
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
          `);
          log.success(`Privileges revoked from ${roleList}.`);
        } else {
          log.info("Note: Neither 'anon' nor 'authenticated' roles exist in this instance (non-Supabase catalog).");
        }
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

  // ----------------------------------------------------------------------------
  // Step 6: Supabase Auth Health & Connectivity Verification
  // ----------------------------------------------------------------------------
  if (!config.skipAuth && config.supabaseUrl) {
    log.step(6, "Verifying Supabase Auth Health & OAuth Connectivity");
    const activeKey = config.serviceRoleKey || config.anonKey;

    try {
      // 1. Health check
      log.info(`Probing Supabase Auth health endpoint: ${config.supabaseUrl}/auth/v1/health`);
      const healthRes = await fetch(`${config.supabaseUrl}/auth/v1/health`, {
        headers: activeKey ? { apikey: activeKey } : {},
      });
      if (!healthRes.ok) {
        throw new Error(`Auth health check returned HTTP ${healthRes.status}: ${healthRes.statusText}`);
      }
      const healthData = await healthRes.json();
      log.success(`Auth Service is HEALTHY: ${healthData.description || "GoTrue"} (v${healthData.version || "unknown"})`);

      // 2. Settings check
      if (activeKey) {
        log.info(`Querying Auth settings endpoint: ${config.supabaseUrl}/auth/v1/settings`);
        const settingsRes = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
          headers: { apikey: activeKey },
        });
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          log.success("Auth settings retrieved successfully.");
          log.dim(`External Providers: Google=${Boolean(settings.external?.google)}, Apple=${Boolean(settings.external?.apple)}, Email=${Boolean(settings.external?.email)}`);
          log.dim(`Signups: ${settings.disable_signup ? "DISABLED" : "ENABLED"}`);
        }
      }

      // 3. Supabase JS Client integration test
      if (config.anonKey) {
        log.info("Testing @supabase/supabase-js client session & OAuth redirect generation...");
        const supabase = createClient(config.supabaseUrl, config.anonKey);

        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) {
          throw sessionErr;
        }
        log.success(`Client getSession() succeeded without error (current session: ${sessionData.session ? "active" : "null"}).`);

        const testRedirectUrl = "https://coffeemode.app/auth/callback";
        const { data: oauthData, error: oauthErr } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: testRedirectUrl },
        });

        if (oauthErr) {
          log.warn(`signInWithOAuth notice: ${oauthErr.message}`);
        } else if (oauthData?.url) {
          log.success("OAuth authorization URL generation verified successfully.");
          log.dim(`Generated URL: ${oauthData.url.slice(0, 70)}...`);
        }
      }
    } catch (authErr) {
      log.error(`Supabase Auth verification error: ${authErr.message}`);
      if (!config.verifyOnly) {
        throw authErr;
      }
    }
  } else if (config.skipAuth) {
    log.info("Supabase Auth check skipped via --skip-auth.");
  }

  console.log(`\n${color.bold}${color.green}==============================================================${color.reset}`);
  console.log(`${color.bold}${color.green}  Supabase Provisioning & Verification Finished Successfully  ${color.reset}`);
  console.log(`${color.bold}${color.green}==============================================================${color.reset}\n`);
}

main().catch((err) => {
  log.error(`Execution halted due to error: ${err.message}`);
  if (process.env.DEBUG || process.argv.includes("--verbose")) {
    console.error(err);
  }
  process.exit(1);
});
